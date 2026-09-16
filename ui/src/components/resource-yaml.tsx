import { useEffect, useMemo, useRef, useState } from 'react'
import type { ResourceYamlProps } from '@kite-dev/plugin-sdk/ui'
import { IconCheck, IconEdit, IconLoader, IconX } from '@tabler/icons-react'
import * as yaml from 'js-yaml'
import type { editor as monacoEditor } from 'monaco-editor'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { MonacoEditor } from '@/lib/monaco-loader'
import {
  defineMonacoBackgroundThemes,
  useMonacoBackgroundColor,
} from '@/lib/monaco-theme'
import { cn, translateError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import { useAppearance } from './appearance-provider'
import { ErrorBoundary } from './error-boundary'

export function ResourceYaml<T>({
  value,
  title,
  actions,
  onSave,
  className,
  fillHeight = false,
}: ResourceYamlProps<T>) {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(false)
  const yamlValue = useMemo(() => yaml.dump(value, { indent: 2 }), [value])
  const [editorValue, setEditorValue] = useState(yamlValue)
  const [isSaving, setIsSaving] = useState(false)
  const [isValidYaml, setIsValidYaml] = useState(true)
  const [validationError, setValidationError] = useState<string>('')
  const { actualTheme, colorTheme } = useAppearance()
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null)
  const validationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const themeMode = actualTheme === 'dark' ? 'dark' : 'light'
  const backgroundColor = useMonacoBackgroundColor(
    '--card',
    themeMode,
    colorTheme
  )

  useEffect(() => {
    setEditorValue(yamlValue)
  }, [yamlValue])

  useEffect(() => {
    try {
      yaml.load(editorValue)
      setIsValidYaml(true)
      setValidationError('')
    } catch (error) {
      setIsValidYaml(false)

      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current)
      }

      validationTimeoutRef.current = setTimeout(() => {
        setValidationError(
          error instanceof Error
            ? error.message.split('\n')[0]
            : t('common.messages.invalidYaml', 'Invalid YAML')
        )
      }, 1000)
    }

    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current)
      }
    }
  }, [editorValue, t])

  const handleEditorChange = (value: string | undefined) => {
    const newValue = value || ''
    setEditorValue(newValue)
  }

  const handleEdit = () => {
    setIsEditing(true)
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.focus()
      }
    }, 100)
  }

  const handleSave = async () => {
    if (!isValidYaml || !onSave) return
    setIsSaving(true)
    try {
      await onSave(yaml.load(editorValue) as T)
      setIsEditing(false)
    } catch (error) {
      toast.error(translateError(error, t))
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setEditorValue(yamlValue)
    setIsEditing(false)
  }

  const handleEditorDidMount = (editor: monacoEditor.IStandaloneCodeEditor) => {
    editorRef.current = editor
  }

  const effectiveReadOnly = !onSave || !isEditing || isSaving
  const editorTitle = title ?? t('common.fields.yamlConfiguration')

  return (
    <Card className={cn(fillHeight && 'h-full min-h-0 flex-1', className)}>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="space-y-1">
          <CardTitle>{editorTitle}</CardTitle>
        </div>
        <div className="flex items-center gap-4">
          {actions}
          {onSave && (
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={!isValidYaml || isSaving}
                  >
                    {isSaving ? (
                      <IconLoader className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <IconCheck className="w-4 h-4 mr-2" />
                    )}
                    {t('common.actions.save')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCancel}
                    disabled={isSaving}
                  >
                    <IconX className="w-4 h-4 mr-2" />
                    {t('common.actions.cancel')}
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={handleEdit}>
                  <IconEdit className="w-4 h-4 mr-2" />
                  {t('common.actions.edit')}
                </Button>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className={cn(fillHeight && 'min-h-0 flex-1')}>
        <div
          className={cn(
            'space-y-2',
            fillHeight && 'flex h-full min-h-0 flex-col'
          )}
        >
          {!isValidYaml && validationError && (
            <div className="px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-md">
              <p className="text-sm text-destructive">{validationError}</p>
            </div>
          )}
          <div
            className={cn(
              'overflow-hidden h-[calc(100dvh-300px)]',
              fillHeight && 'h-auto min-h-0 flex-1'
            )}
          >
            <ErrorBoundary>
              <MonacoEditor
                height={fillHeight ? '100%' : undefined}
                key={`yaml-editor-${colorTheme}-${actualTheme}-${backgroundColor}`}
                language="yaml"
                theme={
                  actualTheme === 'dark'
                    ? `custom-dark-${colorTheme}`
                    : `custom-vs-${colorTheme}`
                }
                value={editorValue}
                loading={
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    {t('common.messages.loadingEditor', 'Loading editor...')}
                  </div>
                }
                beforeMount={(monaco) => {
                  defineMonacoBackgroundThemes(monaco, {
                    darkThemeName: `custom-dark-${colorTheme}`,
                    lightThemeName: `custom-vs-${colorTheme}`,
                    backgroundColor,
                  })
                }}
                onChange={handleEditorChange}
                onMount={handleEditorDidMount}
                options={{
                  readOnly: effectiveReadOnly,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  wordWrap: 'on',
                  lineNumbers: 'on',
                  folding: true,
                  renderLineHighlight: effectiveReadOnly ? 'none' : 'line',
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
            </ErrorBoundary>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
