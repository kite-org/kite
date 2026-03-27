import { useCallback, useEffect, useRef, useState } from 'react'
import { useAIChatContext } from '@/contexts/ai-chat-context'
import * as yaml from 'js-yaml'
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  MessageSquarePlus,
  Send,
  Square,
  Trash2,
  Wrench,
  X,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { useLocation, useSearchParams } from 'react-router-dom'
import remarkGfm from 'remark-gfm'

import { useAIStatus } from '@/lib/api'
import { withSubPath } from '@/lib/subpath'
import { ChatMessage, ChatSession, useAIChat } from '@/hooks/use-ai-chat'
import { useIsMobile } from '@/hooks/use-mobile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { AIChatTrigger } from '@/components/ai-chat/ai-chat-trigger'

const MIN_HEIGHT = 200
const DESKTOP_DEFAULT_HEIGHT_RATIO = 0.62
const MIN_WIDTH = 320
const DEFAULT_WIDTH = 420
const DESKTOP_MARGIN = 16
const MOBILE_DEFAULT_HEIGHT_RATIO = 0.62
const MAX_INPUT_HEIGHT = 220

/** Build a human-readable summary from tool name + args. */
function describeAction(tool: string, args: Record<string, unknown>): string {
  const kind = (args.kind as string) || ''
  const name = (args.name as string) || ''
  const ns = (args.namespace as string) || ''
  const target = ns ? `${kind} ${ns}/${name}` : `${kind} ${name}`

  switch (tool) {
    case 'delete_resource':
      return `Delete ${target}`
    case 'patch_resource': {
      const patch = args.patch as string | undefined
      if (patch) {
        try {
          const obj = JSON.parse(patch)
          if (obj?.spec?.replicas !== undefined) {
            return `Scale ${target} to ${obj.spec.replicas} replicas`
          }
          const anno =
            obj?.spec?.template?.metadata?.annotations?.[
              'kubectl.kubernetes.io/restartedAt'
            ]
          if (anno) {
            return `Restart ${target}`
          }
        } catch {
          // ignore
        }
        return `Patch ${target}: ${patch.length > 80 ? patch.slice(0, 80) + '...' : patch}`
      }
      return `Patch ${target}`
    }
    case 'create_resource': {
      const yaml = (args.yaml as string) || ''
      const kindMatch = yaml.match(/^kind:\s*(.+)$/m)
      const nameMatch = yaml.match(/^\s*name:\s*(.+)$/m)
      if (kindMatch && nameMatch) {
        return `Create ${kindMatch[1].trim()} ${nameMatch[1].trim()}`
      }
      return 'Create resource'
    }
    case 'update_resource': {
      const yaml = (args.yaml as string) || ''
      const kindMatch = yaml.match(/^kind:\s*(.+)$/m)
      const nameMatch = yaml.match(/^\s*name:\s*(.+)$/m)
      if (kindMatch && nameMatch) {
        return `Update ${kindMatch[1].trim()} ${nameMatch[1].trim()}`
      }
      return 'Update resource'
    }
    default:
      return tool
  }
}

function buildToolYamlPreview(
  tool: string | undefined,
  args: Record<string, unknown> | undefined
): string | null {
  if (!tool || !args) {
    return null
  }

  switch (tool) {
    case 'create_resource':
    case 'update_resource': {
      const resourceYaml = args.yaml
      return typeof resourceYaml === 'string' && resourceYaml.trim()
        ? resourceYaml.trim()
        : null
    }
    case 'patch_resource': {
      const patch = args.patch
      if (typeof patch !== 'string' || !patch.trim()) {
        return null
      }

      try {
        const metadata: Record<string, string> = {}
        if (typeof args.name === 'string' && args.name.trim()) {
          metadata.name = args.name.trim()
        }
        if (typeof args.namespace === 'string' && args.namespace.trim()) {
          metadata.namespace = args.namespace.trim()
        }

        const preview: Record<string, unknown> = {
          patch: JSON.parse(patch),
        }
        if (typeof args.kind === 'string' && args.kind.trim()) {
          preview.kind = args.kind.trim()
        }
        if (Object.keys(metadata).length > 0) {
          preview.metadata = metadata
        }

        return yaml
          .dump(preview, {
            indent: 2,
            lineWidth: -1,
            noRefs: true,
          })
          .trim()
      } catch {
        return patch.trim()
      }
    }
    default:
      return null
  }
}

function buildInputDefaults(
  inputRequest: ChatMessage['inputRequest']
): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {}
  for (const field of inputRequest?.fields || []) {
    if (field.type === 'switch') {
      values[field.name] = field.defaultValue === 'true'
      continue
    }
    values[field.name] = field.defaultValue || ''
  }
  return values
}

function ToolCallMessage({
  message,
  onConfirm,
  onDeny,
  onSubmitInput,
}: {
  message: ChatMessage
  onConfirm?: (id: string) => void
  onDeny?: (id: string) => void
  onSubmitInput?: (id: string, values: Record<string, unknown>) => void
}) {
  const { t } = useTranslation()
  const toolYamlPreview = buildToolYamlPreview(
    message.toolName,
    message.toolArgs
  )
  const [expanded, setExpanded] = useState(false)
  const [formValues, setFormValues] = useState<
    Record<string, string | boolean>
  >(() => buildInputDefaults(message.inputRequest))
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const isPending = message.actionStatus === 'pending'
  const isConfirmed = message.actionStatus === 'confirmed'
  const isDenied = message.actionStatus === 'denied'
  const isError = message.actionStatus === 'error'
  const inputRequest = message.inputRequest
  const title = inputRequest?.title || message.toolName

  const statusIcon = () => {
    if (isPending)
      return <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
    if (isConfirmed) return <CheckCircle2 className="h-3 w-3 text-green-500" />
    if (isDenied) return <XCircle className="h-3 w-3 text-muted-foreground" />
    if (isError) return <XCircle className="h-3 w-3 text-red-500" />
    if (message.toolResult)
      return <CheckCircle2 className="h-3 w-3 text-green-500" />
    return <Loader2 className="h-3 w-3 animate-spin" />
  }

  useEffect(() => {
    setFormValues(buildInputDefaults(inputRequest))
    setFormErrors({})
  }, [inputRequest, message.id])

  const updateFormValue = (fieldName: string, nextValue: string | boolean) => {
    setFormValues((prev) => ({
      ...prev,
      [fieldName]: nextValue,
    }))
    setFormErrors((prev) => {
      if (!prev[fieldName]) {
        return prev
      }
      const next = { ...prev }
      delete next[fieldName]
      return next
    })
  }

  const submitForm = () => {
    const nextErrors: Record<string, string> = {}
    for (const field of inputRequest?.fields || []) {
      if (!field.required || field.type === 'switch') {
        continue
      }
      const value = formValues[field.name]
      if (typeof value !== 'string' || value.trim() === '') {
        nextErrors[field.name] = t('aiChat.validation.required', 'Required')
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setFormErrors(nextErrors)
      return
    }

    onSubmitInput?.(message.id, formValues)
  }

  return (
    <div className="mx-3 my-1">
      <button
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <Wrench className="h-3 w-3" />
        <span className="font-medium">{title}</span>
        {statusIcon()}
        <ChevronRight
          className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      {expanded && toolYamlPreview && (
        <div className="mt-1 rounded border bg-muted/40 p-2">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            YAML
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
            {toolYamlPreview}
          </pre>
        </div>
      )}
      {expanded && message.toolResult && (
        <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap break-all">
          {message.toolResult}
        </pre>
      )}
      {inputRequest && (
        <div className="mt-1.5 rounded border border-primary/20 bg-primary/5 p-3">
          <p className="text-sm font-medium text-foreground">
            {inputRequest.title}
          </p>
          {inputRequest.description && (
            <p className="mt-1 text-xs text-muted-foreground">
              {inputRequest.description}
            </p>
          )}
          {inputRequest.kind === 'choice' && (
            <div className="mt-3 flex flex-col gap-2">
              {inputRequest.options?.map((option) => (
                <button
                  key={option.value}
                  className="rounded-md border bg-background px-3 py-2 text-left transition-colors hover:bg-muted"
                  onClick={() =>
                    onSubmitInput?.(message.id, {
                      [inputRequest.name || 'value']: option.value,
                    })
                  }
                >
                  <div className="text-sm font-medium text-foreground">
                    {option.label}
                  </div>
                  {option.description && (
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {option.description}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
          {inputRequest.kind === 'form' && (
            <div className="mt-3 space-y-3">
              {inputRequest.fields?.map((field) => {
                const value = formValues[field.name]
                return (
                  <div key={field.name} className="space-y-1.5">
                    {field.type === 'switch' ? (
                      <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                        <div className="pr-3">
                          <Label htmlFor={`${message.id}-${field.name}`}>
                            {field.label}
                          </Label>
                          {field.description && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {field.description}
                            </p>
                          )}
                        </div>
                        <Switch
                          id={`${message.id}-${field.name}`}
                          checked={value === true}
                          onCheckedChange={(checked) =>
                            updateFormValue(field.name, checked)
                          }
                        />
                      </div>
                    ) : (
                      <>
                        <Label
                          htmlFor={`${message.id}-${field.name}`}
                          className={
                            formErrors[field.name] ? 'text-destructive' : ''
                          }
                        >
                          {field.label}
                          {field.required ? ' *' : ''}
                        </Label>
                        {field.type === 'textarea' ? (
                          <Textarea
                            id={`${message.id}-${field.name}`}
                            value={typeof value === 'string' ? value : ''}
                            placeholder={field.placeholder}
                            className={`min-h-24 bg-background ${formErrors[field.name] ? 'border-destructive' : ''}`}
                            onChange={(e) =>
                              updateFormValue(field.name, e.target.value)
                            }
                          />
                        ) : field.type === 'select' ? (
                          <Select
                            value={
                              typeof value === 'string' && value !== ''
                                ? value
                                : undefined
                            }
                            onValueChange={(nextValue) =>
                              updateFormValue(field.name, nextValue)
                            }
                          >
                            <SelectTrigger
                              className={`w-full bg-background ${formErrors[field.name] ? 'border-destructive' : ''}`}
                            >
                              <SelectValue
                                placeholder={
                                  field.placeholder || 'Select an option'
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {field.options?.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            id={`${message.id}-${field.name}`}
                            type={field.type === 'number' ? 'number' : 'text'}
                            value={typeof value === 'string' ? value : ''}
                            placeholder={field.placeholder}
                            className={`bg-background ${formErrors[field.name] ? 'border-destructive' : ''}`}
                            onChange={(e) =>
                              updateFormValue(field.name, e.target.value)
                            }
                          />
                        )}
                        {field.description && (
                          <p className="text-xs text-muted-foreground">
                            {field.description}
                          </p>
                        )}
                        {formErrors[field.name] && (
                          <p className="text-xs text-destructive">
                            {formErrors[field.name]}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
              <Button size="sm" className="h-8" onClick={submitForm}>
                {inputRequest.submitLabel || 'Continue'}
              </Button>
            </div>
          )}
        </div>
      )}
      {isPending && message.pendingAction && (
        <div className="mt-1.5 rounded border border-yellow-500/30 bg-yellow-500/5 p-2">
          <p className="mb-1.5 text-xs font-medium text-foreground">
            {describeAction(
              message.pendingAction.tool,
              message.pendingAction.args
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              className="h-6 px-2 text-xs"
              onClick={() => onConfirm?.(message.id)}
            >
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Confirm
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={() => onDeny?.(message.id)}
            >
              <XCircle className="mr-1 h-3 w-3" />
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function MessageBubble({
  message,
  onConfirm,
  onDeny,
  onSubmitInput,
}: {
  message: ChatMessage
  onConfirm?: (id: string) => void
  onDeny?: (id: string) => void
  onSubmitInput?: (id: string, values: Record<string, unknown>) => void
}) {
  const [thinkingExpanded, setThinkingExpanded] = useState(false)

  if (message.role === 'tool') {
    return (
      <ToolCallMessage
        message={message}
        onConfirm={onConfirm}
        onDeny={onDeny}
        onSubmitInput={onSubmitInput}
      />
    )
  }

  const isUser = message.role === 'user'
  const hasThinking =
    !isUser && typeof message.thinking === 'string' && message.thinking !== ''
  const hasContent = message.content !== ''

  if (!isUser && !hasThinking && !hasContent) {
    return null
  }

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mx-3 my-2`}
    >
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm wrap-break-word ${
          isUser
            ? 'bg-primary text-primary-foreground whitespace-pre-wrap'
            : 'bg-muted text-foreground'
        }`}
      >
        {isUser ? (
          message.content
        ) : (
          <>
            {hasThinking && (
              <div className="mb-2">
                <button
                  className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setThinkingExpanded((prev) => !prev)}
                >
                  <ChevronRight
                    className={`h-3 w-3 transition-transform ${thinkingExpanded ? 'rotate-90' : ''}`}
                  />
                  Thinking
                </button>
                {thinkingExpanded && (
                  <div className="rounded border border-dashed bg-background/60 p-2 text-xs text-muted-foreground">
                    <div className="whitespace-pre-wrap wrap-break-word">
                      {message.thinking || ''}
                    </div>
                  </div>
                )}
              </div>
            )}
            {hasContent && (
              <div className="ai-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function HistoryPanel({
  history,
  currentSessionId,
  onLoadSession,
  onDeleteSession,
  onNewSession,
  onClose,
}: {
  history: ChatSession[]
  currentSessionId: string | null
  onLoadSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onNewSession: () => void
  onClose: () => void
}) {
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      {/* Header */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b bg-muted/50 px-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Clock className="h-4 w-4" />
          Chat History
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* New chat button */}
      <div className="shrink-0 border-b p-2">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={() => {
            onNewSession()
            onClose()
          }}
        >
          <MessageSquarePlus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      {/* History list */}
      <div className="flex-1 overflow-y-auto">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <Clock className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No chat history yet</p>
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {history.map((session) => (
              <div
                key={session.id}
                className={`group relative rounded-md border p-2 transition-colors hover:bg-muted ${
                  currentSessionId === session.id
                    ? 'border-primary bg-muted'
                    : 'border-transparent'
                }`}
              >
                <button
                  className="w-full text-left"
                  onClick={() => {
                    onLoadSession(session.id)
                    onClose()
                  }}
                >
                  <div className="mb-1 line-clamp-2 text-sm font-medium">
                    {session.title}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatDate(session.updatedAt)}</span>
                    <span>•</span>
                    <span>{session.messages.length} messages</span>
                    {session.clusterName && (
                      <>
                        <span>•</span>
                        <span className="truncate">{session.clusterName}</span>
                      </>
                    )}
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1 h-6 w-6 opacity-0 group-hover:opacity-100 hover:bg-destructive hover:text-destructive-foreground"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteSession(session.id)
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SuggestedPrompts({
  pageContext,
  onSelect,
}: {
  pageContext: {
    page: string
    namespace: string
    resourceName: string
    resourceKind: string
  }
  onSelect: (prompt: string) => void
}) {
  const { t } = useTranslation()

  const prompts: Record<string, string[]> = {
    overview: [
      'aiChat.suggestedPrompts.overview.clusterHealth',
      'aiChat.suggestedPrompts.overview.errorPods',
      'aiChat.suggestedPrompts.overview.namespaceSummary',
    ],
    'pod-detail': [
      'aiChat.suggestedPrompts.podDetail.rootCause',
      'aiChat.suggestedPrompts.podDetail.riskCheck',
      'aiChat.suggestedPrompts.podDetail.troubleshoot',
    ],
    'deployment-detail': [
      'aiChat.suggestedPrompts.deploymentDetail.releaseCheck',
      'aiChat.suggestedPrompts.deploymentDetail.replicaGap',
      'aiChat.suggestedPrompts.deploymentDetail.recentEvents',
    ],
    'node-detail': [
      'aiChat.suggestedPrompts.nodeDetail.health',
      'aiChat.suggestedPrompts.nodeDetail.workloadRisk',
      'aiChat.suggestedPrompts.nodeDetail.actions',
    ],
    detail: [
      'aiChat.suggestedPrompts.detail.summary',
      'aiChat.suggestedPrompts.detail.anomaly',
      'aiChat.suggestedPrompts.detail.nextSteps',
    ],
    list: [
      'aiChat.suggestedPrompts.list.anomalies',
      'aiChat.suggestedPrompts.list.namespaceHotspots',
      'aiChat.suggestedPrompts.list.nextActions',
    ],
    default: [
      'aiChat.suggestedPrompts.default.healthCheck',
      'aiChat.suggestedPrompts.default.workloadIssues',
      'aiChat.suggestedPrompts.default.runbook',
    ],
  }

  const promptSetKey =
    prompts[pageContext.page] != null
      ? pageContext.page
      : pageContext.page.endsWith('-detail')
        ? 'detail'
        : pageContext.page.endsWith('-list')
          ? 'list'
          : 'default'

  const templateValues = {
    resourceKind:
      pageContext.resourceKind ||
      t('aiChat.suggestedPrompts.fallback.resource'),
    resourceName:
      pageContext.resourceName ||
      t('aiChat.suggestedPrompts.fallback.resource'),
    namespace:
      pageContext.namespace || t('aiChat.suggestedPrompts.fallback.namespace'),
  }

  const pagePrompts = prompts[promptSetKey]

  return (
    <div className="flex flex-col items-center gap-2 p-4">
      <Bot className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {t('aiChat.suggestedPrompts.hint')}
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {pagePrompts.map((promptKey) => (
          <button
            key={promptKey}
            className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            onClick={() => onSelect(t(promptKey, templateValues))}
          >
            {t(promptKey, templateValues)}
          </button>
        ))}
      </div>
    </div>
  )
}

interface AIChatboxProps {
  standalone?: boolean
  sessionId?: string
}

export function StandaloneAIChatbox() {
  const [searchParams] = useSearchParams()
  return (
    <AIChatbox
      standalone
      sessionId={searchParams.get('sessionId')?.trim() || ''}
    />
  )
}

export function AIChatbox({
  standalone = false,
  sessionId = '',
}: AIChatboxProps) {
  const { i18n, t } = useTranslation()
  const isMobile = useIsMobile()
  const { isOpen, openChat, closeChat, pageContext } = useAIChatContext()
  const {
    messages,
    isLoading,
    history,
    currentSessionId,
    sendMessage,
    executeAction,
    submitInput,
    denyAction,
    stopGeneration,
    loadSession,
    deleteSession,
    newSession,
    ensureSessionId,
    saveCurrentSession,
  } = useAIChat()

  const { pathname } = useLocation()
  const shouldShowAIChatbox = standalone || !/^\/settings\/?$/.test(pathname)

  const [input, setInput] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [height, setHeight] = useState(() =>
    Math.round(
      (window.visualViewport?.height ?? window.innerHeight) *
        DESKTOP_DEFAULT_HEIGHT_RATIO
    )
  )
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const { data: { enabled: aiEnabled } = { enabled: false } } = useAIStatus()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const heightDragging = useRef(false)
  const widthDragging = useRef(false)
  const startY = useRef(0)
  const startH = useRef(0)
  const startX = useRef(0)
  const startW = useRef(0)

  const getViewportSize = useCallback(() => {
    return {
      width: window.visualViewport?.width ?? window.innerWidth,
      height: window.visualViewport?.height ?? window.innerHeight,
    }
  }, [])

  const [{ width: viewportWidth, height: viewportHeight }, setViewportSize] =
    useState(() => getViewportSize())

  const getDesktopBounds = useCallback((vw: number, vh: number) => {
    const maxWidth = Math.max(MIN_WIDTH, Math.min(720, vw - DESKTOP_MARGIN))
    const minWidth = Math.min(MIN_WIDTH, maxWidth)
    const maxHeight = Math.max(MIN_HEIGHT, vh * 0.85)
    const minHeight = Math.min(MIN_HEIGHT, maxHeight)
    return { minWidth, maxWidth, minHeight, maxHeight }
  }, [])

  useEffect(() => {
    const updateViewport = () => setViewportSize(getViewportSize())
    updateViewport()
    window.addEventListener('resize', updateViewport)
    window.visualViewport?.addEventListener('resize', updateViewport)
    return () => {
      window.removeEventListener('resize', updateViewport)
      window.visualViewport?.removeEventListener('resize', updateViewport)
    }
  }, [getViewportSize])

  useEffect(() => {
    if (isMobile) return
    const bounds = getDesktopBounds(viewportWidth, viewportHeight)
    setWidth((prev) =>
      Math.min(bounds.maxWidth, Math.max(bounds.minWidth, prev))
    )
    setHeight((prev) =>
      Math.min(bounds.maxHeight, Math.max(bounds.minHeight, prev))
    )
  }, [getDesktopBounds, isMobile, viewportHeight, viewportWidth])

  const desktopBounds = getDesktopBounds(viewportWidth, viewportHeight)
  const desktopWidth = Math.min(
    desktopBounds.maxWidth,
    Math.max(desktopBounds.minWidth, width)
  )
  const desktopHeight = Math.min(
    desktopBounds.maxHeight,
    Math.max(desktopBounds.minHeight, height)
  )

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (isOpen || standalone) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen, standalone])

  useEffect(() => {
    if (!standalone || !sessionId) return
    if (currentSessionId === sessionId) return
    if (!history.find((session) => session.id === sessionId)) return
    loadSession(sessionId)
  }, [currentSessionId, history, loadSession, sessionId, standalone])

  const openChatTab = useCallback(() => {
    const sessionId =
      messages.length > 0
        ? saveCurrentSession(currentSessionId || ensureSessionId())
        : currentSessionId
    const params = new URLSearchParams({
      page: pageContext.page,
      namespace: pageContext.namespace,
      resourceName: pageContext.resourceName,
      resourceKind: pageContext.resourceKind,
    })
    if (sessionId) {
      params.set('sessionId', sessionId)
    }
    const url = withSubPath(`/ai-chat-box?${params.toString()}`)
    window.open(url, '_blank', 'noopener,noreferrer')
    closeChat()
  }, [
    closeChat,
    currentSessionId,
    ensureSessionId,
    messages.length,
    pageContext.namespace,
    pageContext.page,
    pageContext.resourceKind,
    pageContext.resourceName,
    saveCurrentSession,
  ])

  const handleSend = useCallback(() => {
    if (!input.trim() || isLoading) return
    const msg = input
    setInput('')
    sendMessage(msg, pageContext, i18n.resolvedLanguage || i18n.language)
  }, [
    i18n.language,
    i18n.resolvedLanguage,
    input,
    isLoading,
    sendMessage,
    pageContext,
  ])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isMobile) return
      heightDragging.current = true
      startY.current = e.clientY
      startH.current = height
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [height, isMobile]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!heightDragging.current || isMobile) return
      const { minHeight, maxHeight } = getDesktopBounds(
        window.innerWidth,
        window.innerHeight
      )
      const newH = Math.min(
        maxHeight,
        Math.max(minHeight, startH.current + (startY.current - e.clientY))
      )
      setHeight(newH)
    },
    [getDesktopBounds, isMobile]
  )

  const onPointerUp = useCallback(() => {
    heightDragging.current = false
  }, [])

  const onWidthPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isMobile) return
      widthDragging.current = true
      startX.current = e.clientX
      startW.current = width
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [isMobile, width]
  )

  const onWidthPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!widthDragging.current || isMobile) return
      const { minWidth, maxWidth } = getDesktopBounds(
        window.innerWidth,
        window.innerHeight
      )
      const newW = Math.min(
        maxWidth,
        Math.max(minWidth, startW.current + (startX.current - e.clientX))
      )
      setWidth(newW)
    },
    [getDesktopBounds, isMobile]
  )

  const onWidthPointerUp = useCallback(() => {
    widthDragging.current = false
  }, [])

  const resizeInput = useCallback(() => {
    const textarea = inputRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_INPUT_HEIGHT)}px`
    textarea.style.overflowY =
      textarea.scrollHeight > MAX_INPUT_HEIGHT ? 'auto' : 'hidden'
  }, [])

  useEffect(() => {
    resizeInput()
  }, [input, resizeInput])

  if (!shouldShowAIChatbox) return null

  // Don't render if AI is not enabled
  if (aiEnabled === false) return null

  if (!standalone && !isOpen) {
    return <AIChatTrigger onOpen={openChat} />
  }

  return (
    <div
      className={
        standalone
          ? 'fixed inset-0 z-50 flex flex-col bg-background'
          : `fixed z-50 flex flex-col border bg-background shadow-2xl ${
              isMobile
                ? 'left-2 right-2 rounded-lg'
                : 'bottom-4 right-4 rounded-lg'
            }`
      }
      style={
        standalone
          ? undefined
          : isMobile
            ? {
                bottom: `calc(env(safe-area-inset-bottom, 0px) + 0.5rem)`,
                height: `${MOBILE_DEFAULT_HEIGHT_RATIO * 100}%`,
              }
            : {
                width: desktopWidth,
                height: desktopHeight,
              }
      }
    >
      {!isMobile && !standalone && (
        <div
          className="absolute -top-1 left-4 right-4 h-2 cursor-ns-resize z-10"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      )}
      {!isMobile && !standalone && (
        <div
          className="absolute -left-1 top-11 bottom-0 w-2 cursor-ew-resize z-10"
          onPointerDown={onWidthPointerDown}
          onPointerMove={onWidthPointerMove}
          onPointerUp={onWidthPointerUp}
        />
      )}

      <div
        className={`flex h-11 shrink-0 items-center justify-between border-b bg-muted/50 px-3 ${
          standalone ? '' : 'rounded-t-lg'
        }`}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Bot className="h-4 w-4" />
          AI Assistant
        </div>

        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setShowHistory(true)}
              >
                <Clock className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Chat history</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={newSession}
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">New chat</TooltipContent>
          </Tooltip>

          {!standalone && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={openChatTab}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Open in new tab</TooltipContent>
            </Tooltip>
          )}

          <Separator orientation="vertical" className="mx-0.5 h-4" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-destructive hover:text-destructive-foreground"
                onClick={standalone ? () => window.close() : closeChat}
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Close</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Chat content */}
      <>
        {/* History panel overlay */}
        {showHistory && (
          <HistoryPanel
            history={history}
            currentSessionId={currentSessionId}
            onLoadSession={loadSession}
            onDeleteSession={deleteSession}
            onNewSession={newSession}
            onClose={() => setShowHistory(false)}
          />
        )}

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
          {messages.length === 0 ? (
            <SuggestedPrompts
              pageContext={pageContext}
              onSelect={(prompt) => {
                setInput(prompt)
                setTimeout(() => inputRef.current?.focus(), 50)
              }}
            />
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  onConfirm={executeAction}
                  onDeny={denyAction}
                  onSubmitInput={submitInput}
                />
              ))}
              {isLoading &&
                !messages.find((m) => m.role === 'tool' && !m.toolResult) && (
                  <div className="mx-3 my-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Bot className="h-3.5 w-3.5 animate-pulse" />
                    <span className="ai-thinking-dots">
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input area */}
        <div className="shrink-0 border-t p-2">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              className="flex-1 min-w-0 resize-none rounded-md border bg-background px-3 py-2 text-sm leading-5 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Ask about your cluster..."
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
            {isLoading ? (
              <Button
                size="icon"
                variant="outline"
                className="h-9 w-9 shrink-0"
                onClick={stopGeneration}
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={handleSend}
                disabled={!input.trim()}
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <p className="mt-1 text-center text-[10px] leading-4 text-muted-foreground">
            {t('aiChat.disclaimer')}
          </p>
        </div>
      </>
    </div>
  )
}
