import { Suspense, useEffect, useRef, useState } from 'react'
import { IconCheck, IconEdit, IconLoader, IconX } from '@tabler/icons-react'
import * as yaml from 'js-yaml'
import type { editor as monacoEditor } from 'monaco-editor'

import { ResourceType, ResourceTypeMap } from '@/types/api'
import { MonacoEditor } from '@/lib/monaco-loader'
import {
  defineMonacoBackgroundThemes,
  useMonacoBackgroundColor,
} from '@/lib/monaco-theme'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import { useAppearance } from './appearance-provider'

interface YamlEditorProps<T extends ResourceType> {
  /** The YAML content to edit */
  value: string
  /** Whether the editor is in read-only mode by default */
  readOnly?: boolean
  /** Whether to show the edit controls */
  showControls?: boolean
  /** Card title */
  title?: string
  /** Minimum height of the editor */
  minHeight?: number
  /** Callback when YAML content changes */
  onChange?: (value: string) => void
  /** Callback when save is clicked */
  onSave?: (value: ResourceTypeMap[T]) => void
  /** Callback when cancel is clicked */
  onCancel?: () => void
  /** Whether save operation is in progress */
  isSaving?: boolean
  /** Custom class name for the card */
  className?: string
}

export function YamlEditor<T extends ResourceType>({
  value,
  readOnly = false,
  showControls = true,
  title = 'YAML Configuration',
  onChange,
  onSave,
  onCancel,
  isSaving = false,
  className,
}: YamlEditorProps<T>) {
  const [isEditing, setIsEditing] = useState(true)
  const [editorValue, setEditorValue] = useState(value)
  const [isValidYaml, setIsValidYaml] = useState(true)
  const [validationError, setValidationError] = useState<string>('')
  const { actualTheme, colorTheme } = useAppearance()
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null)
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const themeMode = actualTheme === 'dark' ? 'dark' : 'light'
  const backgroundColor = useMonacoBackgroundColor(
    '--card',
    themeMode,
    colorTheme
  )

  // Update editor value when value prop changes
  useEffect(() => {
    setEditorValue(value)
  }, [value])

  // Validate YAML on content change with debounce for error display
  useEffect(() => {
    // Immediate validation for isValidYaml state
    try {
      yaml.load(editorValue)
      setIsValidYaml(true)
      setValidationError('') // Clear error immediately when valid
    } catch (error) {
      setIsValidYaml(false) // Set invalid state immediately

      // Clear previous timeout
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current)
      }

      // Delay showing the error message
      validationTimeoutRef.current = setTimeout(() => {
        setValidationError(
          error instanceof Error ? error.message.split('\n')[0] : 'Invalid YAML'
        )
      }, 1000) // 1 second delay only for error message display
    }

    // Cleanup timeout on unmount
    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current)
      }
    }
  }, [editorValue])

  const handleEditorChange = (value: string | undefined) => {
    const newValue = value || ''
    setEditorValue(newValue)
    onChange?.(newValue)
  }

  const handleEdit = () => {
    setIsEditing(true)
    // Focus the editor after setting editing mode
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.focus()
      }
    }, 100)
  }

  const handleSave = () => {
    if (isValidYaml) {
      onSave?.(yaml.load(editorValue) as ResourceTypeMap[T])
      if (!readOnly) {
        setIsEditing(false)
      }
    }
  }

  const handleCancel = () => {
    setIsEditing(false)
    onCancel?.()
  }

  const handleEditorDidMount = (editor: monacoEditor.IStandaloneCodeEditor) => {
    editorRef.current = editor
  }

  const effectiveReadOnly = readOnly || !isEditing

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
        </div>
        <div className="flex items-center gap-4">
          {showControls && (
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
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCancel}
                    disabled={isSaving}
                  >
                    <IconX className="w-4 h-4 mr-2" />
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleEdit}
                  disabled={readOnly}
                >
                  <IconEdit className="w-4 h-4 mr-2" />
                  Edit
                </Button>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {!isValidYaml && validationError && (
            <div className="px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-md">
              <p className="text-sm text-destructive">{validationError}</p>
            </div>
          )}
          <div className="overflow-hidden h-[calc(100dvh-300px)]">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  Loading editor...
                </div>
              }
            >
              <MonacoEditor
                key={`yaml-editor-${colorTheme}-${actualTheme}-${backgroundColor}`}
                language="yaml"
                theme={
                  actualTheme === 'dark'
                    ? `custom-dark-${colorTheme}`
                    : `custom-vs-${colorTheme}`
                }
                value={editorValue}
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
            </Suspense>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
