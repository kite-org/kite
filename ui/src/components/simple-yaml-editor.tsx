import { Suspense } from 'react'

import { MonacoEditor } from '@/lib/monaco-loader'
import {
  defineMonacoBackgroundThemes,
  useMonacoBackgroundColor,
} from '@/lib/monaco-theme'

import { useAppearance } from './appearance-provider'

interface SimpleYamlEditorProps {
  value: string
  onChange: (value: string | undefined) => void
  disabled?: boolean
  height?: string
}

export function SimpleYamlEditor({
  value,
  onChange,
  disabled = false,
  height = '400px',
}: SimpleYamlEditorProps) {
  const { actualTheme, colorTheme } = useAppearance()
  const themeMode = actualTheme === 'dark' ? 'dark' : 'light'
  const backgroundColor = useMonacoBackgroundColor(
    '--background',
    themeMode,
    colorTheme
  )
  return (
    <div className="border rounded-md overflow-hidden">
      <Suspense
        fallback={
          <div
            className="flex items-center justify-center h-full text-muted-foreground"
            style={{ height }}
          >
            Loading editor...
          </div>
        }
      >
        <MonacoEditor
          key={`simple-yaml-editor-${colorTheme}-${actualTheme}-${backgroundColor}`}
          height={height}
          defaultLanguage="yaml"
          value={value}
          onChange={onChange}
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
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            readOnly: disabled,
            fontSize: 14,
            lineNumbers: 'on',
            folding: true,
            autoIndent: 'full',
            formatOnPaste: true,
            formatOnType: true,
            tabSize: 2,
            insertSpaces: true,
            detectIndentation: true,
            renderWhitespace: 'boundary',
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
            fontFamily:
              "'Maple Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
          }}
        />
      </Suspense>
    </div>
  )
}
