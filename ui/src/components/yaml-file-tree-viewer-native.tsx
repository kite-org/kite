import { useMemo, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { MonacoDiffEditor } from '@/lib/monaco-loader'
import {
  defineMonacoBackgroundThemes,
  useMonacoBackgroundColor,
} from '@/lib/monaco-theme'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAppearance } from '@/components/appearance-provider'
import { TextViewer } from '@/components/text-viewer'

export interface YamlFileTreeItem {
  path: string
  content: string
}

export type YamlDiffTreeItemStatus =
  | 'added'
  | 'deleted'
  | 'changed'
  | 'unchanged'

export interface YamlDiffTreeItem {
  path: string
  originalContent: string
  modifiedContent: string
  status: YamlDiffTreeItemStatus
}

type NativeTreeStatus = 'added' | 'deleted' | 'modified'

interface NativeTreeNode<T extends { path: string }> {
  children: NativeTreeNode<T>[]
  file?: T
  name: string
  path: string
  status: NativeTreeStatus | null
  type: 'directory' | 'file'
}

interface NativeTreeRow<T extends { path: string }> {
  depth: number
  node: NativeTreeNode<T>
}

const defaultTreeHeightClassName = 'h-[calc(100dvh-350px)] min-h-72'

function gitStatusForDiffStatus(
  status: YamlDiffTreeItemStatus
): NativeTreeStatus | null {
  switch (status) {
    case 'added':
    case 'deleted':
      return status
    case 'changed':
      return 'modified'
    case 'unchanged':
      return null
  }
}

function getYamlFileSearchText(file: YamlFileTreeItem) {
  return `${file.path}\n${file.content}`
}

function getYamlDiffSearchText(file: YamlDiffTreeItem) {
  return `${file.path}\n${file.status}\n${file.originalContent}\n${file.modifiedContent}`
}

function getYamlDiffGitStatus(file: YamlDiffTreeItem) {
  return gitStatusForDiffStatus(file.status)
}

function emptyDirectory<T extends { path: string }>(
  name: string,
  path: string
): NativeTreeNode<T> {
  return {
    children: [],
    name,
    path,
    status: null,
    type: 'directory',
  }
}

function sortTreeNodes<T extends { path: string }>(nodes: NativeTreeNode<T>[]) {
  nodes.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1
    }
    return left.name.localeCompare(right.name)
  })

  for (const node of nodes) {
    sortTreeNodes(node.children)
  }
}

function markDirectoryStatus<T extends { path: string }>(
  node: NativeTreeNode<T>
) {
  for (const child of node.children) {
    markDirectoryStatus(child)
    if (!node.status && child.status) {
      node.status = 'modified'
    }
  }
}

function buildTree<T extends { path: string }>(
  files: T[],
  getGitStatus?: (file: T) => NativeTreeStatus | null
) {
  const root = emptyDirectory<T>('', '')
  const directories = new Map<string, NativeTreeNode<T>>([['', root]])
  const fileByPath = new Map<string, T>()

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    let parent = root
    let parentPath = ''

    for (const part of parts.slice(0, -1)) {
      const directoryPath = parentPath ? `${parentPath}/${part}` : part
      let directory = directories.get(directoryPath)
      if (!directory) {
        directory = emptyDirectory(part, directoryPath)
        directories.set(directoryPath, directory)
        parent.children.push(directory)
      }
      parent = directory
      parentPath = directoryPath
    }

    const name = parts[parts.length - 1] || file.path
    const fileNode: NativeTreeNode<T> = {
      children: [],
      file,
      name,
      path: file.path,
      status: getGitStatus?.(file) || null,
      type: 'file',
    }
    parent.children.push(fileNode)
    fileByPath.set(file.path, file)
  }

  sortTreeNodes(root.children)
  markDirectoryStatus(root)

  return {
    fileByPath,
    roots: root.children,
  }
}

function flattenTree<T extends { path: string }>(
  nodes: NativeTreeNode<T>[],
  collapsedPaths: ReadonlySet<string>,
  depth = 0
) {
  const rows: NativeTreeRow<T>[] = []

  for (const node of nodes) {
    rows.push({ depth, node })
    if (node.type === 'directory' && !collapsedPaths.has(node.path)) {
      rows.push(...flattenTree(node.children, collapsedPaths, depth + 1))
    }
  }

  return rows
}

function statusClassName(status: NativeTreeStatus | null) {
  switch (status) {
    case 'added':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'deleted':
      return 'text-destructive'
    case 'modified':
      return 'text-sky-600 dark:text-sky-400'
    default:
      return 'text-muted-foreground'
  }
}

function statusLabel(status: NativeTreeStatus | null) {
  switch (status) {
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'modified':
      return 'M'
    default:
      return null
  }
}

function NativeYamlFileTree<T extends { path: string }>({
  roots,
  selectedPath,
  fillHeight,
  onSelect,
}: {
  roots: NativeTreeNode<T>[]
  selectedPath: string
  fillHeight: boolean
  onSelect: (path: string) => void
}) {
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set())
  const rows = useMemo(
    () => flattenTree(roots, collapsedPaths),
    [collapsedPaths, roots]
  )

  return (
    <div
      className={cn(
        'overflow-y-auto overscroll-contain rounded-md bg-card px-2 py-1 text-[13px]',
        fillHeight ? 'min-h-0 flex-1' : defaultTreeHeightClassName
      )}
    >
      {rows.map(({ depth, node }) => {
        const isDirectory = node.type === 'directory'
        const isCollapsed = collapsedPaths.has(node.path)
        const isSelected = node.path === selectedPath
        const StatusIcon = isDirectory
          ? isCollapsed
            ? Folder
            : FolderOpen
          : FileText
        const label = statusLabel(node.status)

        return (
          <button
            key={`${node.type}:${node.path}`}
            type="button"
            className={cn(
              'flex h-[30px] w-full min-w-0 items-center rounded-md pr-2 text-left outline-none transition-colors hover:bg-muted/70 focus-visible:ring-1 focus-visible:ring-ring',
              isSelected && 'bg-accent text-accent-foreground hover:bg-accent'
            )}
            style={{ paddingLeft: 8 + depth * 18 }}
            onClick={() => {
              if (isDirectory) {
                setCollapsedPaths((current) => {
                  const next = new Set(current)
                  if (next.has(node.path)) {
                    next.delete(node.path)
                  } else {
                    next.add(node.path)
                  }
                  return next
                })
                return
              }
              onSelect(node.path)
            }}
          >
            <span className="mr-1 flex size-4 shrink-0 items-center justify-center text-muted-foreground">
              {isDirectory ? (
                isCollapsed ? (
                  <ChevronRight className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )
              ) : null}
            </span>
            <StatusIcon
              className={cn(
                'mr-1.5 size-3.5 shrink-0',
                statusClassName(node.status)
              )}
            />
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            {label ? (
              <span
                className={cn(
                  'ml-2 shrink-0 text-[10px] font-semibold tabular-nums',
                  statusClassName(node.status)
                )}
              >
                {label}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

function NativeYamlTreeViewer<T extends { path: string }>({
  files,
  title,
  emptyMessage,
  fillHeight = false,
  getSearchText,
  getGitStatus,
  renderSelectedFile,
}: {
  files: T[]
  title: string
  emptyMessage: string
  fillHeight?: boolean
  getSearchText: (file: T) => string
  getGitStatus?: (file: T) => NativeTreeStatus | null
  renderSelectedFile: (file: T, fillHeight: boolean) => ReactNode
}) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const visibleFiles = useMemo(
    () =>
      files.filter(
        (file) =>
          !normalizedSearchQuery ||
          getSearchText(file).toLowerCase().includes(normalizedSearchQuery)
      ),
    [files, getSearchText, normalizedSearchQuery]
  )
  const tree = useMemo(
    () => buildTree(visibleFiles, getGitStatus),
    [getGitStatus, visibleFiles]
  )
  const [selectedPath, setSelectedPath] = useState('')
  const selectedFile = tree.fileByPath.get(selectedPath) || visibleFiles[0]

  return (
    <div
      className={cn(
        'grid min-h-0 gap-4 lg:grid-cols-[minmax(16rem,0.32fr)_minmax(0,1fr)]',
        fillHeight && 'h-full min-h-0 flex-1 overflow-hidden'
      )}
    >
      <Card className="flex min-h-0 flex-col gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
        <CardHeader className="shrink-0 px-3 py-2 !pb-2">
          <CardTitle className="text-balance text-sm">{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2 pt-0">
          <Input
            aria-label={t('common.actions.search')}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('common.actions.search')}
            className="h-8"
          />
          {selectedFile ? (
            <NativeYamlFileTree
              roots={tree.roots}
              selectedPath={selectedFile.path}
              fillHeight={fillHeight}
              onSelect={setSelectedPath}
            />
          ) : (
            <div
              className={cn(
                'flex items-center justify-center rounded-md text-sm text-muted-foreground',
                fillHeight ? 'min-h-0 flex-1' : defaultTreeHeightClassName
              )}
            >
              {emptyMessage}
            </div>
          )}
        </CardContent>
      </Card>
      {selectedFile ? (
        renderSelectedFile(selectedFile, fillHeight)
      ) : (
        <Card className={cn(fillHeight && 'h-full')}>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {emptyMessage}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export function YamlFileTreeViewerNative({
  files,
  title,
  emptyMessage,
  fillHeight,
}: {
  files: YamlFileTreeItem[]
  title: string
  emptyMessage: string
  fillHeight?: boolean
}) {
  return (
    <NativeYamlTreeViewer
      files={files}
      title={title}
      emptyMessage={emptyMessage}
      fillHeight={fillHeight}
      getSearchText={getYamlFileSearchText}
      renderSelectedFile={(file, fillHeight) => (
        <TextViewer
          value={file.content}
          title={file.path}
          fillHeight={fillHeight}
        />
      )}
    />
  )
}

export function YamlDiffPanel({
  file,
  fillHeight,
}: {
  file: YamlDiffTreeItem
  fillHeight: boolean
}) {
  const { t } = useTranslation()
  const { actualTheme, colorTheme } = useAppearance()
  const themeMode = actualTheme === 'dark' ? 'dark' : 'light'
  const backgroundColor = useMonacoBackgroundColor(
    '--card',
    themeMode,
    colorTheme
  )
  const darkThemeName = `yaml-diff-dark-${colorTheme}`
  const lightThemeName = `yaml-diff-light-${colorTheme}`
  const statusLabel = {
    added: t('helm.diff.added'),
    deleted: t('helm.diff.deleted'),
    changed: t('helm.diff.changed'),
    unchanged: t('helm.diff.unchanged'),
  }[file.status]

  return (
    <Card className={cn('flex min-h-0 flex-col', fillHeight && 'h-full')}>
      <CardHeader className="flex shrink-0 flex-row items-center justify-between">
        <CardTitle className="min-w-0 truncate">{file.path}</CardTitle>
        <Badge variant="outline">{statusLabel}</Badge>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        <div
          className={cn(
            'overflow-hidden h-[calc(100dvh-300px)]',
            fillHeight && 'h-full min-h-0'
          )}
        >
          <MonacoDiffEditor
            key={`yaml-diff-${colorTheme}-${actualTheme}-${backgroundColor}`}
            height={fillHeight ? '100%' : undefined}
            language="yaml"
            original={file.originalContent}
            modified={file.modifiedContent}
            loading={
              <div className="flex h-full items-center justify-center text-muted-foreground">
                Loading editor...
              </div>
            }
            beforeMount={(monaco) => {
              defineMonacoBackgroundThemes(monaco, {
                darkThemeName,
                lightThemeName,
                backgroundColor,
              })
            }}
            theme={actualTheme === 'dark' ? darkThemeName : lightThemeName}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              wordWrap: 'on',
              lineNumbers: 'on',
              folding: true,
              fontSize: 14,
              fontFamily:
                "'Maple Mono',Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
              renderSideBySide: true,
              enableSplitViewResizing: true,
              ignoreTrimWhitespace: false,
              renderOverviewRuler: true,
            }}
          />
        </div>
      </CardContent>
    </Card>
  )
}

export function YamlFileTreeDiffViewerNative({
  files,
  title,
  emptyMessage,
  fillHeight,
}: {
  files: YamlDiffTreeItem[]
  title: string
  emptyMessage: string
  fillHeight?: boolean
}) {
  return (
    <NativeYamlTreeViewer
      files={files}
      title={title}
      emptyMessage={emptyMessage}
      fillHeight={fillHeight}
      getSearchText={getYamlDiffSearchText}
      getGitStatus={getYamlDiffGitStatus}
      renderSelectedFile={(file, fillHeight) => (
        <YamlDiffPanel file={file} fillHeight={fillHeight} />
      )}
    />
  )
}
