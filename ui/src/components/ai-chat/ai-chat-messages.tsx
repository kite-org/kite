import { useEffect, useState, type RefObject } from 'react'
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  CornerDownLeft,
  Loader2,
  Wrench,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { AIChatThinking } from './ai-chat-thinking'
import { ChatMessage, PageContext } from './ai-chat-types'
import {
  buildInputDefaults,
  buildToolPreview,
  describeAction,
} from './ai-chat-utils'

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
  const toolPreview = buildToolPreview(
    message.pendingAction?.tool || message.toolName,
    message.pendingAction?.args || message.toolArgs
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
  const statusLabel = isError
    ? t('aiChat.failed')
    : isDenied
      ? t('aiChat.cancelled')
      : inputRequest
        ? t('aiChat.awaitingInput')
        : isPending && message.pendingAction
          ? t('aiChat.needsApproval')
          : isConfirmed || message.toolResult
            ? t('aiChat.completed')
            : t('aiChat.running')

  const statusIcon = () => {
    if (isError) return <XCircle className="h-3 w-3 text-red-500" />
    if (isDenied) return <XCircle className="h-3 w-3 text-muted-foreground" />
    if (inputRequest || (isPending && message.pendingAction)) {
      return <CircleHelp className="h-3.5 w-3.5 text-muted-foreground" />
    }
    if (isConfirmed) return <CheckCircle2 className="h-3 w-3 text-green-500" />
    if (message.toolResult) {
      return <CheckCircle2 className="h-3 w-3 text-green-500" />
    }
    return <Loader2 className="h-3 w-3 motion-safe:animate-spin" />
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
        nextErrors[field.name] = t('common.values.required', 'Required')
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setFormErrors(nextErrors)
      return
    }

    onSubmitInput?.(message.id, formValues)
  }

  return (
    <div className="mx-5 my-1 border-l pl-3.5">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`tool-details-${message.id}`}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setExpanded(!expanded)}
      >
        <Wrench className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate font-medium text-foreground/85">
          {title}
        </span>
        <span className="ml-auto shrink-0 text-[11px]">{statusLabel}</span>
        {statusIcon()}
        <ChevronRight
          className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      <div id={`tool-details-${message.id}`} hidden={!expanded}>
        {expanded && toolPreview && (
          <div className="my-2 rounded-lg border bg-muted/30 p-3">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {toolPreview.label}
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
              {toolPreview.content}
            </pre>
          </div>
        )}
        {expanded && message.toolResult && (
          <pre className="my-2 max-h-40 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-all">
            {message.toolResult}
          </pre>
        )}
      </div>
      {inputRequest && (
        <div className="my-2 rounded-xl border bg-card p-4 shadow-xs">
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
                  className="rounded-lg border bg-background px-3 py-2.5 text-left transition-colors hover:border-ring/40 hover:bg-muted"
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
                                  field.placeholder || t('aiChat.selectOption')
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
              <div className="flex items-center gap-2">
                <Button size="sm" className="h-8" onClick={submitForm}>
                  {inputRequest.submitLabel || t('aiChat.continue')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => onDeny?.(message.id)}
                >
                  {t('common.actions.cancel', 'Cancel')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {isPending && message.pendingAction && (
        <div className="my-2 rounded-xl border bg-card p-4 shadow-xs">
          <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <CircleHelp className="size-3.5" />
            {t('aiChat.needsApproval')}
          </p>
          <p className="mb-3 text-sm font-medium text-foreground wrap-break-word">
            {describeAction(
              message.pendingAction.tool,
              message.pendingAction.args
            ).replace(/^(Patch .*?): .+$/, '$1')}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              className="h-8 rounded-lg px-3 text-xs"
              onClick={() => onConfirm?.(message.id)}
            >
              <CheckCircle2 className="mr-1 h-3 w-3" />
              {t('common.actions.confirm')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-lg px-3 text-xs"
              onClick={() => onDeny?.(message.id)}
            >
              <XCircle className="mr-1 h-3 w-3" />
              {t('common.actions.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function MessageBubble({
  message,
  isThinking,
  onConfirm,
  onDeny,
  onSubmitInput,
}: {
  message: ChatMessage
  isThinking: boolean
  onConfirm?: (id: string) => void
  onDeny?: (id: string) => void
  onSubmitInput?: (id: string, values: Record<string, unknown>) => void
}) {
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
      className={`mx-5 my-4 flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`min-w-0 overflow-hidden text-sm wrap-break-word ${
          isUser
            ? 'max-w-[85%] rounded-2xl bg-muted px-3.5 py-2.5 text-foreground whitespace-pre-wrap'
            : 'w-full text-foreground'
        }`}
      >
        {isUser ? (
          message.content
        ) : (
          <>
            {hasThinking && (
              <div className={hasContent ? 'mb-3' : ''}>
                <AIChatThinking
                  content={message.thinking}
                  isThinking={isThinking}
                />
              </div>
            )}
            {hasContent && (
              <div className="ai-markdown min-w-0 overflow-x-auto text-pretty">
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

function SuggestedPrompts({
  pageContext,
  onSelect,
}: {
  pageContext: PageContext
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

  return (
    <div className="flex min-h-full flex-col justify-center px-5 py-8">
      <Bot className="mb-4 h-7 w-7 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">
        {t('aiChat.suggestedPrompts.hint')}
      </p>
      <div className="mt-4 flex flex-col">
        {prompts[promptSetKey].map((promptKey) => (
          <button
            key={promptKey}
            className="flex items-start gap-2.5 rounded-lg py-2.5 text-left text-xs leading-5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            onClick={() => onSelect(t(promptKey, templateValues))}
          >
            <CornerDownLeft className="mt-1 size-3 shrink-0" />
            {t(promptKey, templateValues)}
          </button>
        ))}
      </div>
    </div>
  )
}

export function AIChatMessages({
  messages,
  pageContext,
  isLoading,
  hasActiveToolExecution,
  onConfirm,
  onDeny,
  onSubmitInput,
  onPromptSelect,
  messagesEndRef,
}: {
  messages: ChatMessage[]
  pageContext: PageContext
  isLoading: boolean
  hasActiveToolExecution: boolean
  onConfirm?: (id: string) => void
  onDeny?: (id: string) => void
  onSubmitInput?: (id: string, values: Record<string, unknown>) => void
  onPromptSelect: (prompt: string) => void
  messagesEndRef: RefObject<HTMLDivElement | null>
}) {
  const lastMessage = messages.at(-1)
  const hasStreamingAssistant =
    lastMessage?.role === 'assistant' &&
    Boolean(lastMessage.thinking || lastMessage.content)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto py-2 scrollbar-hide">
      {messages.length === 0 ? (
        <SuggestedPrompts pageContext={pageContext} onSelect={onPromptSelect} />
      ) : (
        <>
          {messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              isThinking={
                isLoading && index === messages.length - 1 && !message.content
              }
              onConfirm={onConfirm}
              onDeny={onDeny}
              onSubmitInput={onSubmitInput}
            />
          ))}
          {isLoading && !hasActiveToolExecution && !hasStreamingAssistant && (
            <div className="mx-5 my-4">
              <AIChatThinking isThinking />
            </div>
          )}
          <div ref={messagesEndRef} />
        </>
      )}
    </div>
  )
}
