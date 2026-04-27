import { useEffect, useState, type RefObject } from 'react'
import {
  Bot,
  CheckCircle2,
  ChevronRight,
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

import { ChatMessage, PageContext } from './ai-chat-types'
import {
  buildInputDefaults,
  buildToolYamlPreview,
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
    if (isPending) {
      return <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
    }
    if (isConfirmed) return <CheckCircle2 className="h-3 w-3 text-green-500" />
    if (isDenied) return <XCircle className="h-3 w-3 text-muted-foreground" />
    if (isError) return <XCircle className="h-3 w-3 text-red-500" />
    if (message.toolResult) {
      return <CheckCircle2 className="h-3 w-3 text-green-500" />
    }
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
    <div className="mx-3 my-1">
      <button
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
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
              <div className="flex items-center gap-2">
                <Button size="sm" className="h-8" onClick={submitForm}>
                  {inputRequest.submitLabel || 'Continue'}
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
      className={`mx-3 my-2 flex ${isUser ? 'justify-end' : 'justify-start'}`}
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
                  className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setThinkingExpanded((prev) => !prev)}
                >
                  <ChevronRight
                    className={`h-3 w-3 transition-transform ${thinkingExpanded ? 'rotate-90' : ''}`}
                  />
                  Thinking
                </button>
                {thinkingExpanded && (
                  <div className="rounded border border-dashed bg-background/60 p-2 text-xs text-muted-foreground">
                    <div className="wrap-break-word whitespace-pre-wrap">
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
    <div className="flex flex-col items-center gap-2 p-4">
      <Bot className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {t('aiChat.suggestedPrompts.hint')}
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {prompts[promptSetKey].map((promptKey) => (
          <button
            key={promptKey}
            className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => onSelect(t(promptKey, templateValues))}
          >
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
  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
      {messages.length === 0 ? (
        <SuggestedPrompts pageContext={pageContext} onSelect={onPromptSelect} />
      ) : (
        <>
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onConfirm={onConfirm}
              onDeny={onDeny}
              onSubmitInput={onSubmitInput}
            />
          ))}
          {isLoading && !hasActiveToolExecution && (
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
  )
}
