import { useCallback, useRef, useState } from 'react'

import { withSubPath } from '@/lib/subpath'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  thinking?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolResult?: string
  pendingAction?: { tool: string; args: Record<string, unknown> }
  actionStatus?: 'pending' | 'confirmed' | 'denied' | 'error'
}

export interface PageContext {
  page: string
  namespace: string
  resourceName: string
  resourceKind: string
}

type APIChatMessage = { role: 'user' | 'assistant'; content: string }

const defaultPageContext: PageContext = {
  page: '',
  namespace: '',
  resourceName: '',
  resourceKind: '',
}

export function useAIChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const messagesRef = useRef<ChatMessage[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  const activeAssistantMsgIdRef = useRef<string | null>(null)
  const startNewAssistantSegmentRef = useRef(false)
  const lastPageContextRef = useRef<PageContext>(defaultPageContext)
  const lastLanguageRef = useRef('en')

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
          const { tool, args } = data as {
            tool: string
            args: Record<string, unknown>
          }
          updateLatestToolMessage(tool, (message) => ({
            ...message,
            content: `${tool} requires confirmation`,
            pendingAction: { tool, args },
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

  const buildAPIMessagesFromCurrentState = useCallback(
    (extra: APIChatMessage[] = []) => {
      const history = messagesRef.current
        .filter(
          (m): m is ChatMessage & { role: 'user' | 'assistant' } =>
            m.role === 'user' || m.role === 'assistant'
        )
        .map((m) => ({ role: m.role, content: m.content }))
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
      }
    },
    [
      appendAssistantError,
      buildAPIMessagesFromCurrentState,
      isLoading,
      streamChat,
      updateMessages,
    ]
  )

  const executeAction = useCallback(
    async (messageId: string) => {
      const msg = messagesRef.current.find((m) => m.id === messageId)
      if (!msg?.pendingAction) return

      const clusterName = localStorage.getItem('current-cluster') || ''

      try {
        const response = await fetch(withSubPath('/api/v1/ai/execute'), {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'x-cluster-name': clusterName,
          },
          body: JSON.stringify(msg.pendingAction),
        })

        const result = await response.json()
        const resultMessage =
          typeof result.message === 'string' ? result.message : 'unknown error'

        updateMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  actionStatus: response.ok
                    ? ('confirmed' as const)
                    : ('error' as const),
                  toolResult: resultMessage,
                  content: response.ok
                    ? `${msg.toolName} completed`
                    : `${msg.toolName} failed`,
                }
              : m
          )
        )

        if (!response.ok) {
          return
        }

        setIsLoading(true)
        try {
          activeAssistantMsgIdRef.current = generateId()
          startNewAssistantSegmentRef.current = false
          abortControllerRef.current = new AbortController()

          const continuationMessages = buildAPIMessagesFromCurrentState([
            {
              role: 'assistant',
              content: resultMessage,
            },
            {
              role: 'user',
              content:
                'The confirmed action has been executed successfully. Continue with the remaining steps and call tools as needed until the task is complete.',
            },
          ])

          await streamChat(
            continuationMessages,
            lastPageContextRef.current || defaultPageContext,
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
    [
      appendAssistantError,
      buildAPIMessagesFromCurrentState,
      streamChat,
      updateMessages,
    ]
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
  }, [])

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsLoading(false)
  }, [])

  return {
    messages,
    isLoading,
    sendMessage,
    executeAction,
    denyAction,
    clearMessages,
    stopGeneration,
  }
}
