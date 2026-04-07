import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { useAIChatContext } from '@/contexts/ai-chat-context'
import { Bot, Clock, ExternalLink, MessageSquarePlus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { withSubPath } from '@/lib/subpath'
import { useAIChat } from '@/hooks/use-ai-chat'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { AIChatComposer } from './ai-chat-composer'
import { AIChatHistoryPanel } from './ai-chat-history-panel'
import { AIChatMessages } from './ai-chat-messages'

export function AIChatPanel({
  standalone = false,
  sessionId = '',
  onClose,
}: {
  standalone?: boolean
  sessionId?: string
  onClose: () => void
}) {
  const { i18n } = useTranslation()
  const { closeChat, pageContext } = useAIChatContext()
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
  const [input, setInput] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!standalone || !sessionId) return
    if (currentSessionId === sessionId) return
    if (!history.find((session) => session.id === sessionId)) return
    loadSession(sessionId)
  }, [currentSessionId, history, loadSession, sessionId, standalone])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
    }, 100)

    return () => window.clearTimeout(timer)
  }, [inputRef])

  const handleSend = useCallback(() => {
    if (!input.trim() || isLoading) return
    const nextInput = input
    setInput('')
    sendMessage(nextInput, pageContext, i18n.resolvedLanguage || i18n.language)
  }, [
    i18n.language,
    i18n.resolvedLanguage,
    input,
    isLoading,
    pageContext,
    sendMessage,
  ])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const hasActiveToolExecution = messages.some(
    (message) =>
      message.role === 'tool' &&
      !message.toolResult &&
      !message.inputRequest &&
      !message.pendingAction &&
      message.actionStatus !== 'denied' &&
      message.actionStatus !== 'error'
  )

  const openChatTab = useCallback(() => {
    const nextSessionId =
      messages.length > 0
        ? saveCurrentSession(currentSessionId || ensureSessionId())
        : currentSessionId
    const params = new URLSearchParams({
      page: pageContext.page,
      namespace: pageContext.namespace,
      resourceName: pageContext.resourceName,
      resourceKind: pageContext.resourceKind,
    })
    if (nextSessionId) {
      params.set('sessionId', nextSessionId)
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

  const handlePromptSelect = useCallback(
    (prompt: string) => {
      setInput(prompt)
      window.setTimeout(() => inputRef.current?.focus(), 50)
    },
    [inputRef]
  )

  const handleNewSession = useCallback(() => {
    newSession()
    setShowHistory(false)
    setInput('')
  }, [newSession])

  const shouldCloseStandalone = standalone ? onClose : closeChat

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b bg-muted/50 px-3">
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
                onClick={handleNewSession}
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
                onClick={shouldCloseStandalone}
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Close</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {showHistory && (
        <AIChatHistoryPanel
          history={history}
          currentSessionId={currentSessionId}
          onLoadSession={loadSession}
          onDeleteSession={deleteSession}
          onNewSession={handleNewSession}
          onClose={() => setShowHistory(false)}
        />
      )}

      <AIChatMessages
        messages={messages}
        pageContext={pageContext}
        isLoading={isLoading}
        hasActiveToolExecution={hasActiveToolExecution}
        onConfirm={executeAction}
        onDeny={denyAction}
        onSubmitInput={submitInput}
        onPromptSelect={handlePromptSelect}
        messagesEndRef={messagesEndRef}
      />

      <AIChatComposer
        value={input}
        isLoading={isLoading}
        onChange={setInput}
        onSend={handleSend}
        onStop={stopGeneration}
        onKeyDown={handleKeyDown}
        inputRef={inputRef}
      />
    </div>
  )
}
