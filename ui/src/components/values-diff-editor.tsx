import { useEffect, useRef } from 'react'

import { MonacoDiffEditor } from '@/lib/monaco-loader'
import {
  defineMonacoBackgroundThemes,
  useMonacoBackgroundColor,
} from '@/lib/monaco-theme'

import { useAppearance } from './appearance-provider'

interface ValuesDiffEditorProps {
  /** Original (base) YAML content shown on the left — always read-only */
  original: string
  /** Modified (target) YAML content shown on the right */
  modified: string
  /** Height of the diff editor, defaults to 400px */
  height?: string
  /** Render side-by-side (default) or inline diff */
  renderSideBySide?: boolean
  /**
   * When provided, the modified (right) side is editable and this fires with
   * its latest value on every keystroke, so users edit values while the diff
   * against the fixed base updates live (kubeapps-style). Omit for a fully
   * read-only diff (e.g. history comparison).
   */
  onModifiedChange?: (value: string) => void
  /** Force read-only even when onModifiedChange is set (e.g. while submitting) */
  readOnly?: boolean
}

/**
 * Inline YAML diff editor. The left side is a fixed read-only base; the right
 * side can be made editable via onModifiedChange so users edit values and see
 * the diff update live. A chrome-free counterpart to {@link YamlDiffViewer}
 * (dialog) and `YamlDiffPanel` (Card + path header), matching
 * {@link SimpleYamlEditor}'s look.
 */
export function ValuesDiffEditor({
  original,
  modified,
  height = '400px',
  renderSideBySide = true,
  onModifiedChange,
  readOnly = false,
}: ValuesDiffEditorProps) {
  const { actualTheme, colorTheme } = useAppearance()
  const themeMode = actualTheme === 'dark' ? 'dark' : 'light'
  const backgroundColor = useMonacoBackgroundColor(
    '--background',
    themeMode,
    colorTheme
  )
  const editable = !!onModifiedChange && !readOnly
  // Monaco fires onDidChangeModelContent while the diff editor is being
  // disposed; without this guard an unmount (e.g. switching to the dry-run
  // preview) leaks a phantom "edit" into onModifiedChange.
  const unmountedRef = useRef(false)
  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [])

  return (
    <div className="border rounded-md overflow-hidden">
      <MonacoDiffEditor
        key={`values-diff-${colorTheme}-${actualTheme}-${backgroundColor}`}
        height={height}
        language="yaml"
        original={original}
        modified={modified}
        loading={
          <div
            className="flex items-center justify-center h-full text-muted-foreground"
            style={{ height }}
          >
            Loading editor...
          </div>
        }
        beforeMount={(monaco) => {
          defineMonacoBackgroundThemes(monaco, {
            darkThemeName: `custom-dark-${colorTheme}`,
            lightThemeName: `custom-vs-${colorTheme}`,
            backgroundColor,
          })
        }}
        onMount={(editor) => {
          if (!onModifiedChange) {
            return
          }
          const modifiedEditor = editor.getModifiedEditor()
          modifiedEditor.onDidChangeModelContent(() => {
            const model = modifiedEditor.getModel()
            if (unmountedRef.current || !model || model.isDisposed()) {
              return
            }
            onModifiedChange(modifiedEditor.getValue())
          })
        }}
        theme={
          actualTheme === 'dark'
            ? `custom-dark-${colorTheme}`
            : `custom-vs-${colorTheme}`
        }
        options={{
          readOnly: !editable,
          originalEditable: false,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: 'on',
          lineNumbers: 'on',
          folding: true,
          fontSize: 14,
          renderSideBySide,
          enableSplitViewResizing: true,
          ignoreTrimWhitespace: false,
          renderOverviewRuler: true,
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
          fontFamily:
            "'Maple Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
        }}
      />
    </div>
  )
}
