import { MonacoEditor } from '@/lib/monaco-loader'
import {
  defineMonacoBackgroundThemes,
  useMonacoBackgroundColor,
} from '@/lib/monaco-theme'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppearance } from '@/components/appearance-provider'

interface TextViewerProps {
  value: string
  title?: string
  className?: string
  fillHeight?: boolean
}

export function TextViewer({
  value,
  title = 'Text',
  className,
  fillHeight = false,
}: TextViewerProps) {
  const { actualTheme, colorTheme } = useAppearance()
  const themeMode = actualTheme === 'dark' ? 'dark' : 'light'
  const backgroundColor = useMonacoBackgroundColor(
    '--card',
    themeMode,
    colorTheme
  )
  const darkThemeName = `text-viewer-dark-${colorTheme}`
  const lightThemeName = `text-viewer-light-${colorTheme}`

  return (
    <Card className={cn(fillHeight && 'flex min-h-0 flex-col', className)}>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className={cn(fillHeight && 'min-h-0 flex-1')}>
        <div
          className={cn(
            'space-y-2',
            fillHeight && 'flex h-full min-h-0 flex-col'
          )}
        >
          <div
            className={cn(
              'overflow-hidden h-[calc(100dvh-300px)]',
              fillHeight && 'h-auto min-h-0 flex-1'
            )}
          >
            <MonacoEditor
              key={`text-viewer-${colorTheme}-${actualTheme}-${backgroundColor}`}
              height={fillHeight ? '100%' : undefined}
              language="yaml"
              theme={actualTheme === 'dark' ? darkThemeName : lightThemeName}
              value={value}
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
              options={{
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: 'on',
                lineNumbers: 'on',
                folding: true,
                tabSize: 2,
                insertSpaces: true,
                fontSize: 14,
                fontFamily:
                  "'Maple Mono',Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
                acceptSuggestionOnCommitCharacter: false,
                acceptSuggestionOnEnter: 'off',
                quickSuggestions: false,
                suggestOnTriggerCharacters: false,
                wordBasedSuggestions: 'off',
                parameterHints: { enabled: false },
                hover: { enabled: false },
                contextmenu: false,
                smoothScrolling: true,
                cursorSmoothCaretAnimation: 'on',
                multiCursorModifier: 'alt',
                accessibilitySupport: 'off',
                quickSuggestionsDelay: 500,
                links: false,
                colorDecorators: false,
              }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
