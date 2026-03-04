import { useCallback, useEffect, useRef, useState } from 'react'
import { useAIChatContext } from '@/contexts/ai-chat-context'
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Loader2,
  Send,
  Square,
  Trash2,
  Wrench,
  X,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { useAIStatus } from '@/lib/api'
import { ChatMessage, useAIChat } from '@/hooks/use-ai-chat'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const MIN_HEIGHT = 200
const DEFAULT_HEIGHT = 500
const MIN_WIDTH = 320
const DEFAULT_WIDTH = 420

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

function ToolCallMessage({
  message,
  onConfirm,
  onDeny,
}: {
  message: ChatMessage
  onConfirm?: (id: string) => void
  onDeny?: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isPending = message.actionStatus === 'pending'
  const isConfirmed = message.actionStatus === 'confirmed'
  const isDenied = message.actionStatus === 'denied'
  const isError = message.actionStatus === 'error'

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

  return (
    <div className="mx-3 my-1">
      <button
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <Wrench className="h-3 w-3" />
        <span className="font-medium">{message.toolName}</span>
        {statusIcon()}
        <ChevronRight
          className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      {expanded && message.toolResult && (
        <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap break-all">
          {message.toolResult}
        </pre>
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
}: {
  message: ChatMessage
  onConfirm?: (id: string) => void
  onDeny?: (id: string) => void
}) {
  const [thinkingExpanded, setThinkingExpanded] = useState(false)

  if (message.role === 'tool') {
    return (
      <ToolCallMessage
        message={message}
        onConfirm={onConfirm}
        onDeny={onDeny}
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
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm break-words ${
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
                    <div className="whitespace-pre-wrap break-words">
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
  page,
  onSelect,
}: {
  page: string
  onSelect: (prompt: string) => void
}) {
  const { t } = useTranslation()

  const prompts: Record<string, string[]> = {
    overview: [
      'aiChat.suggestedPrompts.overview.clusterHealth',
      'aiChat.suggestedPrompts.overview.errorPods',
      'aiChat.suggestedPrompts.overview.listNamespaces',
    ],
    'pod-detail': [
      'aiChat.suggestedPrompts.podDetail.showLogs',
      'aiChat.suggestedPrompts.podDetail.status',
      'aiChat.suggestedPrompts.podDetail.issues',
    ],
    'deployment-detail': [
      'aiChat.suggestedPrompts.deploymentDetail.rolloutStatus',
      'aiChat.suggestedPrompts.deploymentDetail.runningReplicas',
      'aiChat.suggestedPrompts.deploymentDetail.recentEvents',
    ],
    default: [
      'aiChat.suggestedPrompts.default.clusterOverview',
      'aiChat.suggestedPrompts.default.listPods',
      'aiChat.suggestedPrompts.default.issues',
    ],
  }

  const pagePrompts = prompts[page] || prompts['default']

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
            onClick={() => onSelect(t(promptKey))}
          >
            {t(promptKey)}
          </button>
        ))}
      </div>
    </div>
  )
}

export function AIChatbox() {
  const { i18n, t } = useTranslation()
  const {
    isOpen,
    isMinimized,
    openChat,
    closeChat,
    minimizeChat,
    pageContext,
  } = useAIChatContext()
  const {
    messages,
    isLoading,
    sendMessage,
    executeAction,
    denyAction,
    clearMessages,
    stopGeneration,
  } = useAIChat()

  const [input, setInput] = useState('')
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
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

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && !isMinimized) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen, isMinimized])

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
      if (isMinimized) return
      heightDragging.current = true
      startY.current = e.clientY
      startH.current = height
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [height, isMinimized]
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!heightDragging.current) return
    const maxHeight = window.innerHeight * 0.8
    const newH = Math.min(
      maxHeight,
      Math.max(MIN_HEIGHT, startH.current + (startY.current - e.clientY))
    )
    setHeight(newH)
  }, [])

  const onPointerUp = useCallback(() => {
    heightDragging.current = false
  }, [])

  const onWidthPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isMinimized) return
      widthDragging.current = true
      startX.current = e.clientX
      startW.current = width
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [isMinimized, width]
  )

  const onWidthPointerMove = useCallback((e: React.PointerEvent) => {
    if (!widthDragging.current) return
    const maxWidth = window.innerWidth * 0.4
    const newW = Math.min(
      maxWidth,
      Math.max(MIN_WIDTH, startW.current + (startX.current - e.clientX))
    )
    setWidth(newW)
  }, [])

  const onWidthPointerUp = useCallback(() => {
    widthDragging.current = false
  }, [])

  // Don't render if AI is not enabled
  if (aiEnabled === false) return null

  // FAB button when chat is closed
  if (!isOpen) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className="fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full shadow-lg"
            size="icon"
            onClick={openChat}
          >
            <Bot className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">AI Assistant</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col rounded-lg border bg-background shadow-2xl"
      style={{
        width,
        height: isMinimized ? 44 : height,
      }}
    >
      {/* Resize handle */}
      {!isMinimized && (
        <div
          className="absolute -top-1 left-4 right-4 h-2 cursor-ns-resize z-10"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      )}
      {!isMinimized && (
        <div
          className="absolute -left-1 top-11 bottom-0 w-2 cursor-ew-resize z-10"
          onPointerDown={onWidthPointerDown}
          onPointerMove={onWidthPointerMove}
          onPointerUp={onWidthPointerUp}
        />
      )}

      {/* Header */}
      <div className="flex h-11 shrink-0 items-center justify-between rounded-t-lg border-b bg-muted/50 px-3">
        <button
          className="flex items-center gap-2 text-sm font-semibold text-foreground hover:opacity-70 transition-opacity"
          onClick={() => (isMinimized ? openChat() : minimizeChat())}
        >
          <Bot className="h-4 w-4" />
          AI Assistant
        </button>

        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={clearMessages}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Clear chat</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-0.5 h-4" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => (isMinimized ? openChat() : minimizeChat())}
              >
                {isMinimized ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {isMinimized ? 'Restore' : 'Minimize'}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-destructive hover:text-destructive-foreground"
                onClick={closeChat}
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Close</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Chat content */}
      {!isMinimized && (
        <>
          {/* Messages area */}
          <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
            {messages.length === 0 ? (
              <SuggestedPrompts
                page={pageContext.page}
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
                  />
                ))}
                {isLoading &&
                  !messages.find((m) => m.role === 'tool' && !m.toolResult) && (
                    <div className="mx-3 my-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Thinking...
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
                className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
      )}
    </div>
  )
}
