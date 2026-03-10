import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/contexts/auth-context'

import { withSubPath } from '@/lib/subpath'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  thinking?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolResult?: string
  pendingAction?: {
    sessionId: string
    tool: string
    args: Record<string, unknown>
  }
  actionStatus?: 'pending' | 'confirmed' | 'denied' | 'error'
}

export interface PageContext {
  page: string
  namespace: string
  resourceName: string
  resourceKind: string
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  clusterName?: string
}

type APIChatMessage = { role: 'user' | 'assistant'; content: string }

const defaultPageContext: PageContext = {
  page: '',
  namespace: '',
  resourceName: '',
  resourceKind: '',
}

const HISTORY_STORAGE_KEY_PREFIX = 'ai-chat-history-'
const MAX_HISTORY_SESSIONS = 50

function loadHistoryFromStorage(username: string): ChatSession[] {
  try {
    const key = `${HISTORY_STORAGE_KEY_PREFIX}${username || 'anonymous'}`
    const stored = localStorage.getItem(key)
    if (!stored) return []
    return JSON.parse(stored)
  } catch {
    return []
  }
}

function saveHistoryToStorage(username: string, sessions: ChatSession[]) {
  try {
    const key = `${HISTORY_STORAGE_KEY_PREFIX}${username || 'anonymous'}`
    localStorage.setItem(key, JSON.stringify(sessions))
  } catch {
    // ignore storage errors
  }
}

// TODO: generate session title with AI to better summarize the conversation, instead of just using the first user message
function generateSessionTitle(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find((m) => m.role === 'user')
  if (!firstUserMessage) return 'New Chat'
  const content = firstUserMessage.content.trim()
  return content.length > 50 ? content.slice(0, 50) + '...' : content
}

export function useAIChat() {
  const { user } = useAuth()
  const username = user?.Key() || 'anonymous'

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [history, setHistory] = useState<ChatSession[]>([])
  const messagesRef = useRef<ChatMessage[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  const activeAssistantMsgIdRef = useRef<string | null>(null)
  const startNewAssistantSegmentRef = useRef(false)
  const lastPageContextRef = useRef<PageContext>(defaultPageContext)
  const lastLanguageRef = useRef('en')

  // Load history when username becomes available or changes
  // TODO: save in backend.
  useEffect(() => {
    if (username) {
      setHistory(loadHistoryFromStorage(username))
    }
  }, [username])

  const generateId = () =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

  const updateMessages = useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      setMessages((prev) => {
        const next = updater(prev)
        messagesRef.current = next
        return next
      })
    },
    []
  )

  const saveCurrentSession = useCallback(() => {
    if (messagesRef.current.length === 0) return

    const now = Date.now()
    const sessionId = currentSessionId || generateId()
    const title = generateSessionTitle(messagesRef.current)
    const clusterName = localStorage.getItem('current-cluster') || ''

    setHistory((prev) => {
      const existingIndex = prev.findIndex((s) => s.id === sessionId)
      const session: ChatSession = {
        id: sessionId,
        title,
        messages: messagesRef.current,
        createdAt: existingIndex >= 0 ? prev[existingIndex].createdAt : now,
        updatedAt: now,
        clusterName,
      }

      let updated: ChatSession[]
      if (existingIndex >= 0) {
        updated = [...prev]
        updated[existingIndex] = session
      } else {
        updated = [session, ...prev]
      }

      // Keep only the most recent sessions
      if (updated.length > MAX_HISTORY_SESSIONS) {
        updated = updated.slice(0, MAX_HISTORY_SESSIONS)
      }

      saveHistoryToStorage(username, updated)
      return updated
    })

    setCurrentSessionId(sessionId)
  }, [currentSessionId, username])

  const appendAssistantError = useCallback(
    (message: string) => {
      updateMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: 'assistant',
          content: `Error: ${message}`,
        },
      ])
    },
    [updateMessages]
  )

  const updateLatestToolMessage = useCallback(
    (tool: string, updater: (message: ChatMessage) => ChatMessage) => {
      updateMessages((prev) => {
        const index = [...prev]
          .reverse()
          .findIndex((m) => m.role === 'tool' && m.toolName === tool)
        if (index < 0) {
          return prev
        }
        const targetIndex = prev.length - 1 - index
        return prev.map((m, i) => (i === targetIndex ? updater(m) : m))
      })
    },
    [updateMessages]
  )

  const handleSSEEvent = useCallback(
    (eventType: string, data: Record<string, unknown>) => {
      switch (eventType) {
        case 'message': {
          const content = (data as { content: string }).content
          if (typeof content !== 'string') {
            break
          }
          if (
            startNewAssistantSegmentRef.current ||
            !activeAssistantMsgIdRef.current
          ) {
            activeAssistantMsgIdRef.current = generateId()
            startNewAssistantSegmentRef.current = false
          }
          const assistantMsgId = activeAssistantMsgIdRef.current
          if (!assistantMsgId) {
            break
          }

          updateMessages((prev) => {
            const existing = prev.find((m) => m.id === assistantMsgId)
            if (existing) {
              return prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: `${m.content}${content}` }
                  : m
              )
            }
            return [
              ...prev,
              {
                id: assistantMsgId,
                role: 'assistant' as const,
                content,
                thinking: '',
              },
            ]
          })
          break
        }
        case 'think': {
          const thinking = (data as { content: string }).content
          if (typeof thinking !== 'string') {
            break
          }
          if (
            startNewAssistantSegmentRef.current ||
            !activeAssistantMsgIdRef.current
          ) {
            activeAssistantMsgIdRef.current = generateId()
            startNewAssistantSegmentRef.current = false
          }
          const assistantMsgId = activeAssistantMsgIdRef.current
          if (!assistantMsgId) {
            break
          }

          updateMessages((prev) => {
            const existing = prev.find((m) => m.id === assistantMsgId)
            if (existing) {
              return prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, thinking: `${m.thinking || ''}${thinking}` }
                  : m
              )
            }
            return [
              ...prev,
              {
                id: assistantMsgId,
                role: 'assistant' as const,
                content: '',
                thinking,
              },
            ]
          })
          break
        }
        case 'tool_call': {
          const { tool, args } = data as {
            tool: string
            args: Record<string, unknown>
          }
          startNewAssistantSegmentRef.current = true
          updateMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: 'tool' as const,
              content: `Calling ${tool}...`,
              toolName: tool,
              toolArgs: args,
            },
          ])
          break
        }
        case 'tool_result': {
          const { tool, result, is_error } = data as {
            tool: string
            result: unknown
            is_error?: boolean
          }
          const toolResult =
            typeof result === 'string' ? result : JSON.stringify(result ?? '')
          const inferredError =
            typeof is_error === 'boolean'
              ? is_error
              : /^(error:|forbidden:|tool error:)/i.test(toolResult.trim())
          updateLatestToolMessage(tool, (message) => ({
            ...message,
            content: `${tool} ${inferredError ? 'failed' : 'completed'}`,
            toolResult,
            actionStatus: inferredError ? 'error' : 'confirmed',
          }))
          break
        }
        case 'action_required': {
          const { tool, args, session_id } = data as {
            tool: string
            args: Record<string, unknown>
            session_id: string
          }
          if (!session_id) {
            appendAssistantError(
              `Missing session id for pending action ${tool}`
            )
            break
          }
          updateLatestToolMessage(tool, (message) => ({
            ...message,
            content: `${tool} requires confirmation`,
            pendingAction: { tool, args, sessionId: session_id },
            actionStatus: 'pending' as const,
          }))
          break
        }
        case 'error': {
          const { message } = data as { message: string }
          appendAssistantError(message)
          break
        }
      }
    },
    [appendAssistantError, updateLatestToolMessage, updateMessages]
  )

  const readSSEStream = useCallback(
    async (response: Response) => {
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let eventType = ''
      let eventDataLines: string[] = []

      const processLine = (line: string) => {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          eventDataLines.push(line.slice(6))
        } else if (line === '') {
          flushEvent()
        }
      }

      const flushEvent = () => {
        if (!eventType || eventDataLines.length === 0) {
          eventType = ''
          eventDataLines = []
          return
        }

        try {
          const data = JSON.parse(eventDataLines.join('\n'))
          handleSSEEvent(eventType, data)
        } catch {
          // ignore invalid SSE payload
        }

        eventType = ''
        eventDataLines = []
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          processLine(line)
        }
      }

      buffer += decoder.decode()
      const remainingLines = buffer.split('\n')
      buffer = remainingLines.pop() || ''
      for (const line of remainingLines) {
        processLine(line)
      }

      if (buffer.trim() !== '') {
        processLine(buffer.trim())
      }
      flushEvent()
    },
    [handleSSEEvent]
  )

  const streamChat = useCallback(
    async (
      apiMessages: APIChatMessage[],
      pageContext: PageContext,
      language: string,
      abortSignal?: AbortSignal
    ) => {
      const clusterName = localStorage.getItem('current-cluster') || ''
      const requestLanguage = (language || '').trim() || 'en'

      const response = await fetch(withSubPath('/api/v1/ai/chat'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': requestLanguage,
          'x-cluster-name': clusterName,
        },
        body: JSON.stringify({
          messages: apiMessages,
          language: requestLanguage,
          page_context: {
            page: pageContext.page,
            namespace: pageContext.namespace,
            resource_name: pageContext.resourceName,
            resource_kind: pageContext.resourceKind,
          },
        }),
        signal: abortSignal,
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(
          errData.error || `HTTP error! status: ${response.status}`
        )
      }

      await readSSEStream(response)
    },
    [readSSEStream]
  )

  const buildAPIMessagesFromCurrentState = useCallback(
    (extra: APIChatMessage[] = []) => {
      const history: APIChatMessage[] = []

      for (const m of messagesRef.current) {
        if (m.role === 'user' || m.role === 'assistant') {
          history.push({ role: m.role, content: m.content })
        } else if (m.role === 'tool' && m.toolResult) {
          // Include tool results as assistant messages to preserve context
          const toolSummary = `[Tool: ${m.toolName}]\nResult: ${m.toolResult}`
          history.push({ role: 'assistant', content: toolSummary })
        }
      }

      return [...history, ...extra]
    },
    []
  )

  const sendMessage = useCallback(
    async (content: string, pageContext: PageContext, language: string) => {
      const trimmed = content.trim()
      if (!trimmed || isLoading) return

      lastPageContextRef.current = pageContext
      lastLanguageRef.current = (language || '').trim() || 'en'
      const baseMessages = buildAPIMessagesFromCurrentState()

      updateMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: 'user',
          content: trimmed,
        },
      ])
      setIsLoading(true)

      const apiMessages = [
        ...baseMessages,
        { role: 'user' as const, content: trimmed },
      ]

      activeAssistantMsgIdRef.current = generateId()
      startNewAssistantSegmentRef.current = false

      try {
        abortControllerRef.current = new AbortController()
        await streamChat(
          apiMessages,
          pageContext,
          lastLanguageRef.current,
          abortControllerRef.current.signal
        )
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          appendAssistantError((error as Error).message)
        }
      } finally {
        setIsLoading(false)
        abortControllerRef.current = null
        activeAssistantMsgIdRef.current = null
        startNewAssistantSegmentRef.current = false
        saveCurrentSession()
      }
    },
    [
      appendAssistantError,
      buildAPIMessagesFromCurrentState,
      isLoading,
      saveCurrentSession,
      streamChat,
      updateMessages,
    ]
  )

  const executeAction = useCallback(
    async (messageId: string) => {
      const msg = messagesRef.current.find((m) => m.id === messageId)
      if (!msg?.pendingAction) return

      const sessionId = msg.pendingAction.sessionId?.trim()
      if (!sessionId) {
        updateMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  actionStatus: 'error' as const,
                  pendingAction: undefined,
                  toolResult:
                    'This pending action has expired. Please ask the AI to generate the action again.',
                  content: `${msg.toolName} failed`,
                }
              : m
          )
        )
        return
      }

      const clusterName = localStorage.getItem('current-cluster') || ''

      try {
        updateMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  actionStatus: 'pending' as const,
                  pendingAction: undefined,
                  content: `${msg.toolName} executing`,
                }
              : m
          )
        )

        setIsLoading(true)
        try {
          activeAssistantMsgIdRef.current = generateId()
          startNewAssistantSegmentRef.current = false
          abortControllerRef.current = new AbortController()

          const response = await fetch(
            withSubPath('/api/v1/ai/execute/continue'),
            {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                'x-cluster-name': clusterName,
              },
              body: JSON.stringify({ sessionId }),
              signal: abortControllerRef.current.signal,
            }
          )

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}))
            throw new Error(
              errData.error || `HTTP error! status: ${response.status}`
            )
          }

          await readSSEStream(response)
        } catch (error) {
          if ((error as Error).name !== 'AbortError') {
            appendAssistantError((error as Error).message)
            updateMessages((prev) =>
              prev.map((m) =>
                m.id === messageId
                  ? {
                      ...m,
                      actionStatus: 'error' as const,
                      toolResult: (error as Error).message,
                      content: `${msg.toolName} failed`,
                    }
                  : m
              )
            )
          }
        } finally {
          setIsLoading(false)
          abortControllerRef.current = null
          activeAssistantMsgIdRef.current = null
          startNewAssistantSegmentRef.current = false
          saveCurrentSession()
        }
      } catch (error) {
        updateMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  actionStatus: 'error' as const,
                  toolResult: (error as Error).message,
                  content: `${msg.toolName} failed`,
                }
              : m
          )
        )
      }
    },
    [appendAssistantError, readSSEStream, saveCurrentSession, updateMessages]
  )

  const denyAction = useCallback(
    (messageId: string) => {
      updateMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                actionStatus: 'denied' as const,
                content: `${m.toolName} cancelled`,
              }
            : m
        )
      )
    },
    [updateMessages]
  )

  const clearMessages = useCallback(() => {
    messagesRef.current = []
    setMessages([])
    setCurrentSessionId(null)
  }, [])

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsLoading(false)
  }, [])

  const loadSession = useCallback(
    (sessionId: string) => {
      const session = history.find((s) => s.id === sessionId)
      if (!session) return

      messagesRef.current = session.messages
      setMessages(session.messages)
      setCurrentSessionId(sessionId)
    },
    [history]
  )

  const deleteSession = useCallback(
    (sessionId: string) => {
      setHistory((prev) => {
        const updated = prev.filter((s) => s.id !== sessionId)
        saveHistoryToStorage(username, updated)
        return updated
      })

      if (currentSessionId === sessionId) {
        clearMessages()
      }
    },
    [clearMessages, currentSessionId, username]
  )

  const newSession = useCallback(() => {
    clearMessages()
  }, [clearMessages])

  return {
    messages,
    isLoading,
    history,
    currentSessionId,
    sendMessage,
    executeAction,
    denyAction,
    clearMessages,
    stopGeneration,
    loadSession,
    deleteSession,
    newSession,
  }
}
