import { Suspense, useRef, useState } from 'react'
import * as yaml from 'js-yaml'
import type { editor as monacoEditor } from 'monaco-editor'
import { useTranslation } from 'react-i18next'

import { MonacoDiffEditor } from '@/lib/monaco-loader'
import {
  defineMonacoBackgroundThemes,
  useMonacoBackgroundColor,
} from '@/lib/monaco-theme'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { useAppearance } from './appearance-provider'

interface YamlDiffViewerProps {
  /** Original YAML content */
  original: string
  /** Modified YAML content */
  modified: string
  /** Current YAML content (for current vs modified diff) */
  current?: string
  /** Whether the dialog is open */
  open: boolean
  /** Callback when dialog is closed */
  onOpenChange: (open: boolean) => void
  /** Callback when user wants to rollback to a specific version */
  onRollback?: (yamlContent: string) => void
  /** Whether rollback operation is in progress */
  isRollingBack?: boolean
  /** Dialog title */
  title?: string
  /** Height of the diff editor */
  height?: number
}

type DiffMode = 'previous-vs-modified' | 'current-vs-modified'

export function YamlDiffViewer({
  original,
  modified,
  current,
  open,
  onOpenChange,
  onRollback,
  isRollingBack = false,
  title = 'YAML Diff',
  height = 600,
}: YamlDiffViewerProps) {
  const { t } = useTranslation()
  const { actualTheme, colorTheme } = useAppearance()
  const themeMode = actualTheme === 'dark' ? 'dark' : 'light'
  const backgroundColor = useMonacoBackgroundColor(
    '--background',
    themeMode,
    colorTheme
  )
  const editorRef = useRef<monacoEditor.IStandaloneDiffEditor | null>(null)
  const [diffMode, setDiffMode] = useState<DiffMode>('previous-vs-modified')

  const handleEditorDidMount = (editor: monacoEditor.IStandaloneDiffEditor) => {
    editorRef.current = editor
  }

  // Remove status field from YAML content
  const removeStatusField = (yamlContent: string): string => {
    if (!yamlContent.trim()) return yamlContent

    try {
      const parsed = yaml.load(yamlContent)
      if (parsed && typeof parsed === 'object') {
        // Remove status field recursively
        const removeStatus = (obj: unknown): unknown => {
          if (obj && typeof obj === 'object') {
            if (Array.isArray(obj)) {
              return obj.map(removeStatus)
            } else {
              const result: Record<string, unknown> = {}
              for (const [key, value] of Object.entries(obj)) {
                if (key !== 'status') {
                  result[key] = removeStatus(value)
                }
              }
              return result
            }
          }
          return obj
        }

        const cleaned = removeStatus(parsed)
        return yaml.dump(cleaned, { indent: 2, sortKeys: true })
      }
    } catch (error) {
      console.error('Failed to remove status field from YAML:', error)
    }

    return yamlContent
  }

  // Determine which content to show based on diff mode
  const getDiffContent = () => {
    if (diffMode === 'current-vs-modified' && current) {
      return {
        original: removeStatusField(current),
        modified: removeStatusField(modified),
      }
    }
    return {
      original: removeStatusField(original),
      modified: removeStatusField(modified),
    }
  }

  const { original: leftContent, modified: rightContent } = getDiffContent()

  // Handle rollback button clicks
  const handleRollbackClick = (yamlContent: string) => {
    if (onRollback) {
      onRollback(yamlContent)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-6xl sm:!max-w-6xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span className="text-lg font-bold">{title}</span>
            <div className="flex items-center gap-2 mr-4">
              {current && (
                <>
                  {diffMode === 'current-vs-modified' && (
                    <Button
                      onClick={() => handleRollbackClick(modified)}
                      disabled={isRollingBack}
                      variant="outline"
                      size="sm"
                    >
                      {isRollingBack
                        ? t('resourceHistory.rollback.rollingBack')
                        : t('resourceHistory.rollback.modified')}
                    </Button>
                  )}

                  {diffMode === 'previous-vs-modified' && (
                    <>
                      <Button
                        onClick={() => handleRollbackClick(original)}
                        disabled={isRollingBack}
                        variant="outline"
                        size="sm"
                      >
                        {isRollingBack
                          ? t('resourceHistory.rollback.rollingBack')
                          : t('resourceHistory.rollback.previous')}
                      </Button>
                      <Button
                        onClick={() => handleRollbackClick(modified)}
                        disabled={isRollingBack}
                        variant="outline"
                        size="sm"
                      >
                        {isRollingBack
                          ? t('resourceHistory.rollback.rollingBack')
                          : t('resourceHistory.rollback.modified')}
                      </Button>
                    </>
                  )}

                  <Select
                    value={diffMode}
                    onValueChange={(value: DiffMode) => setDiffMode(value)}
                  >
                    <SelectTrigger className="max-w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="previous-vs-modified">
                        {t('resourceHistory.previousVsModified')}
                      </SelectItem>
                      <SelectItem value="current-vs-modified">
                        {t('resourceHistory.currentVsModified')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0">
          <Suspense
            fallback={
              <div
                className="flex h-full items-center justify-center text-muted-foreground"
                style={{ height }}
              >
                Loading editor...
              </div>
            }
          >
            <MonacoDiffEditor
              key={`yaml-diff-viewer-${colorTheme}-${actualTheme}-${backgroundColor}`}
              height={height}
              language="yaml"
              beforeMount={(monaco) => {
                defineMonacoBackgroundThemes(monaco, {
                  darkThemeName: `custom-dark-${colorTheme}`,
                  lightThemeName: `custom-vs-${colorTheme}`,
                  backgroundColor,
                })
              }}
              theme={
                actualTheme === 'dark'
                  ? `custom-dark-${colorTheme}`
                  : `custom-vs-${colorTheme}`
              }
              options={{
                readOnly: true,
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                folding: true,
                lineNumbers: 'relative',
                fontSize: 14,
                fontFamily:
                  "'Maple Mono',Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
                renderSideBySide: true,
                enableSplitViewResizing: true,
                renderOverviewRuler: true,
                overviewRulerBorder: true,
                overviewRulerLanes: 2,
              }}
              onMount={handleEditorDidMount}
              original={leftContent}
              modified={rightContent}
            />
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  )
}
