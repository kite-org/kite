import { useCallback, useEffect, useReducer, useRef } from 'react'
import { useAuth } from '@/contexts/auth-context'

import {
  appendCurrentClusterHeader,
  getCurrentCluster,
} from '@/lib/current-cluster'
import { withSubPath } from '@/lib/subpath'
import {
  aiChatReducer,
  deleteChatSession,
  initialAIChatState,
  loadHistoryFromStorage,
  saveHistoryToStorage,
  upsertChatSession,
} from '@/components/ai-chat/ai-chat-state'
import { readAIChatSSEStream } from '@/components/ai-chat/ai-chat-stream'
import {
  APIChatMessage,
  ChatMessage,
  ChatSession,
  PageContext,
} from '@/components/ai-chat/ai-chat-types'

export type {
  ChatMessage,
  ChatSession,
  PageContext,
} from '@/components/ai-chat/ai-chat-types'

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function useAIChat() {
  const { user } = useAuth()
  const username = user?.Key() || 'anonymous'

  const [state, dispatch] = useReducer(aiChatReducer, initialAIChatState)
  const messagesRef = useRef<ChatMessage[]>(state.messages)
  const historyRef = useRef<ChatSession[]>(state.history)
  const currentSessionIdRef = useRef<string | null>(state.currentSessionId)
  const isLoadingRef = useRef(state.isLoading)
  const abortControllerRef = useRef<AbortController | null>(null)
  const activeAssistantMsgIdRef = useRef<string | null>(null)
  const startNewAssistantSegmentRef = useRef(false)

  useEffect(() => {
    messagesRef.current = state.messages
  }, [state.messages])

  useEffect(() => {
    historyRef.current = state.history
  }, [state.history])

  useEffect(() => {
    currentSessionIdRef.current = state.currentSessionId
  }, [state.currentSessionId])

  useEffect(() => {
    isLoadingRef.current = state.isLoading
  }, [state.isLoading])

  useEffect(() => {
    const nextHistory = loadHistoryFromStorage(username)
    historyRef.current = nextHistory
    dispatch({ type: 'history/set', history: nextHistory })
  }, [username])

  useEffect(() => {
    if (!state.currentSessionId || state.messages.length === 0) return

    const nextHistory = upsertChatSession(
      historyRef.current,
      state.currentSessionId,
      state.messages,
      getCurrentCluster() || ''
    )

    if (nextHistory !== historyRef.current) {
      historyRef.current = nextHistory
      dispatch({ type: 'history/set', history: nextHistory })
      saveHistoryToStorage(username, nextHistory)
    }
  }, [state.currentSessionId, state.messages, username])

  const commitMessages = useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      const next = updater(messagesRef.current)
      messagesRef.current = next
      dispatch({ type: 'messages/set', messages: next })
      return next
    },
    []
  )

  const commitHistory = useCallback(
    (nextHistory: ChatSession[]) => {
      historyRef.current = nextHistory
      dispatch({ type: 'history/set', history: nextHistory })
      saveHistoryToStorage(username, nextHistory)
    },
    [username]
  )

  const commitCurrentSessionId = useCallback((sessionId: string | null) => {
    currentSessionIdRef.current = sessionId
    dispatch({ type: 'session/set', sessionId })
  }, [])

  const commitLoading = useCallback((isLoading: boolean) => {
    isLoadingRef.current = isLoading
    dispatch({ type: 'loading/set', isLoading })
  }, [])

  const updateMessageById = useCallback(
    (messageId: string, updater: (message: ChatMessage) => ChatMessage) => {
      commitMessages((prev) =>
        prev.map((message) =>
          message.id === messageId ? updater(message) : message
        )
      )
    },
    [commitMessages]
  )

  const appendAssistantError = useCallback(
    (message: string) => {
      commitMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: 'assistant',
          content: `Error: ${message}`,
        },
      ])
    },
    [commitMessages]
  )

  const updateToolMessage = useCallback(
    (
      toolCallId: string | undefined,
      tool: string,
      updater: (message: ChatMessage) => ChatMessage
    ) => {
      commitMessages((prev) => {
        let targetIndex = -1

        if (toolCallId) {
          targetIndex = prev.findIndex(
            (message) =>
              message.role === 'tool' && message.toolCallId === toolCallId
          )
        }

        if (targetIndex < 0) {
          const index = [...prev]
            .reverse()
            .findIndex(
              (message) => message.role === 'tool' && message.toolName === tool
            )
          if (index < 0) {
            return prev
          }
          targetIndex = prev.length - 1 - index
        }

        return prev.map((message, index) =>
          index === targetIndex ? updater(message) : message
        )
      })
    },
    [commitMessages]
  )

  const appendToAssistantStream = useCallback(
    (field: 'content' | 'thinking', chunk: string) => {
      if (typeof chunk !== 'string') return
      if (
        startNewAssistantSegmentRef.current ||
        !activeAssistantMsgIdRef.current
      ) {
        activeAssistantMsgIdRef.current = generateId()
        startNewAssistantSegmentRef.current = false
      }
      const assistantMsgId = activeAssistantMsgIdRef.current
      if (!assistantMsgId) return

      commitMessages((prev) => {
        const existing = prev.find((m) => m.id === assistantMsgId)
        if (existing) {
          return prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, [field]: `${m[field] || ''}${chunk}` }
              : m
          )
        }
        return [
          ...prev,
          {
            id: assistantMsgId,
            role: 'assistant' as const,
            content: field === 'content' ? chunk : '',
            thinking: field === 'thinking' ? chunk : '',
          },
        ]
      })
    },
    [commitMessages]
  )

  const handleSSEEvent = useCallback(
    (eventType: string, data: Record<string, unknown>) => {
      switch (eventType) {
        case 'message':
          appendToAssistantStream(
            'content',
            (data as { content: string }).content
          )
          break
        case 'think':
          appendToAssistantStream(
            'thinking',
            (data as { content: string }).content
          )
          break
        case 'tool_call': {
          const { tool, tool_call_id, args } = data as {
            tool: string
            tool_call_id?: string
            args: Record<string, unknown>
          }
          startNewAssistantSegmentRef.current = true
          commitMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: 'tool' as const,
              content: `Calling ${tool}...`,
              toolCallId:
                typeof tool_call_id === 'string' ? tool_call_id : undefined,
              toolName: tool,
              toolArgs: args,
            },
          ])
          break
        }
        case 'tool_result': {
          const { tool, tool_call_id, result, is_error } = data as {
            tool: string
            tool_call_id?: string
            result: unknown
            is_error?: boolean
          }
          const toolResult =
            typeof result === 'string' ? result : JSON.stringify(result ?? '')
          const inferredError =
            typeof is_error === 'boolean'
              ? is_error
              : /^(error:|forbidden:|tool error:)/i.test(toolResult.trim())
          updateToolMessage(tool_call_id, tool, (message) => ({
            ...message,
            content: `${tool} ${inferredError ? 'failed' : 'completed'}`,
            toolResult,
            actionStatus: inferredError ? 'error' : 'confirmed',
          }))
          break
        }
        case 'action_required': {
          const { tool, tool_call_id, args, session_id } = data as {
            tool: string
            tool_call_id?: string
            args: Record<string, unknown>
            session_id: string
          }
          if (!session_id) {
            appendAssistantError(
              `Missing session id for pending action ${tool}`
            )
            break
          }
          updateToolMessage(tool_call_id, tool, (message) => ({
            ...message,
            content: `${tool} requires confirmation`,
            pendingAction: { tool, args, sessionId: session_id },
            actionStatus: 'pending' as const,
          }))
          break
        }
        case 'input_required': {
          const {
            tool,
            tool_call_id,
            session_id,
            kind,
            name,
            title,
            description,
            submit_label,
            options,
            fields,
          } = data as {
            tool: string
            tool_call_id?: string
            session_id: string
            kind: string
            name?: string
            title?: string
            description?: string
            submit_label?: string
            options?: Array<{
              label: string
              value: string
              description?: string
            }>
            fields?: Array<{
              name: string
              label: string
              type: 'text' | 'number' | 'textarea' | 'select' | 'switch'
              required?: boolean
              placeholder?: string
              description?: string
              default_value?: string
              options?: Array<{
                label: string
                value: string
                description?: string
              }>
            }>
          }
          if (!session_id) {
            appendAssistantError(`Missing session id for input request ${tool}`)
            break
          }
          if (kind !== 'choice' && kind !== 'form') {
            appendAssistantError(`Unsupported input request type ${kind}`)
            break
          }

          updateToolMessage(tool_call_id, tool, (message) => ({
            ...message,
            content: `${tool} requires input`,
            inputRequest: {
              sessionId: session_id,
              kind,
              name:
                typeof name === 'string' && name.trim()
                  ? name.trim()
                  : undefined,
              title:
                typeof title === 'string' && title.trim() ? title.trim() : tool,
              description:
                typeof description === 'string' && description.trim()
                  ? description.trim()
                  : undefined,
              submitLabel:
                typeof submit_label === 'string' && submit_label.trim()
                  ? submit_label.trim()
                  : undefined,
              options: Array.isArray(options)
                ? options
                    .filter(
                      (option) =>
                        option != null &&
                        typeof option.label === 'string' &&
                        typeof option.value === 'string'
                    )
                    .map((option) => ({
                      label: option.label,
                      value: option.value,
                      description:
                        typeof option.description === 'string'
                          ? option.description
                          : undefined,
                    }))
                : undefined,
              fields: Array.isArray(fields)
                ? fields
                    .filter(
                      (field) =>
                        field != null &&
                        typeof field.name === 'string' &&
                        typeof field.label === 'string' &&
                        typeof field.type === 'string'
                    )
                    .map((field) => ({
                      name: field.name,
                      label: field.label,
                      type: field.type,
                      required: field.required === true,
                      placeholder:
                        typeof field.placeholder === 'string'
                          ? field.placeholder
                          : undefined,
                      description:
                        typeof field.description === 'string'
                          ? field.description
                          : undefined,
                      defaultValue:
                        typeof field.default_value === 'string'
                          ? field.default_value
                          : undefined,
                      options: Array.isArray(field.options)
                        ? field.options
                            .filter(
                              (option) =>
                                option != null &&
                                typeof option.label === 'string' &&
                                typeof option.value === 'string'
                            )
                            .map((option) => ({
                              label: option.label,
                              value: option.value,
                              description:
                                typeof option.description === 'string'
                                  ? option.description
                                  : undefined,
                            }))
                        : undefined,
                    }))
                : undefined,
            },
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
    [
      appendAssistantError,
      appendToAssistantStream,
      commitMessages,
      updateToolMessage,
    ]
  )

  const readSSEStream = useCallback(
    async (response: Response) => {
      return readAIChatSSEStream(response, handleSSEEvent)
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
      const requestLanguage = (language || '').trim() || 'en'
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept-Language': requestLanguage,
      }
      appendCurrentClusterHeader(headers)

      const response = await fetch(withSubPath('/api/v1/ai/chat'), {
        method: 'POST',
        credentials: 'include',
        headers,
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

      for (const message of messagesRef.current) {
        if (message.role === 'user' || message.role === 'assistant') {
          history.push({ role: message.role, content: message.content })
        } else if (message.role === 'tool' && message.toolResult) {
          const toolSummary = `[Tool: ${message.toolName}]\nResult: ${message.toolResult}`
          history.push({ role: 'assistant', content: toolSummary })
        }
      }

      return [...history, ...extra]
    },
    []
  )

  const ensureSessionId = useCallback(() => {
    if (currentSessionIdRef.current) return currentSessionIdRef.current
    const sessionId = generateId()
    commitCurrentSessionId(sessionId)
    return sessionId
  }, [commitCurrentSessionId])

  const saveCurrentSession = useCallback(
    (sessionId?: string | null) => {
      if (messagesRef.current.length === 0) return null

      const resolvedSessionId =
        sessionId || currentSessionIdRef.current || generateId()
      const nextHistory = upsertChatSession(
        historyRef.current,
        resolvedSessionId,
        messagesRef.current,
        getCurrentCluster() || ''
      )
      commitHistory(nextHistory)
      if (currentSessionIdRef.current !== resolvedSessionId) {
        commitCurrentSessionId(resolvedSessionId)
      }
      return resolvedSessionId
    },
    [commitCurrentSessionId, commitHistory]
  )

  const sendMessage = useCallback(
    async (content: string, pageContext: PageContext, language: string) => {
      const trimmed = content.trim()
      if (!trimmed || isLoadingRef.current) return

      const sessionId = ensureSessionId()
      const requestLanguage = (language || '').trim() || 'en'
      const baseMessages = buildAPIMessagesFromCurrentState()

      commitMessages((prev) => [
        ...prev.map((message) =>
          message.inputRequest
            ? {
                ...message,
                actionStatus: 'denied' as const,
                inputRequest: undefined,
                content: `${message.toolName || 'input request'} cancelled`,
              }
            : message
        ),
        {
          id: generateId(),
          role: 'user',
          content: trimmed,
        },
      ])
      commitLoading(true)

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
          requestLanguage,
          abortControllerRef.current.signal
        )
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          appendAssistantError((error as Error).message)
        }
      } finally {
        commitLoading(false)
        abortControllerRef.current = null
        activeAssistantMsgIdRef.current = null
        startNewAssistantSegmentRef.current = false
        saveCurrentSession(sessionId)
      }
    },
    [
      appendAssistantError,
      buildAPIMessagesFromCurrentState,
      commitLoading,
      commitMessages,
      ensureSessionId,
      saveCurrentSession,
      streamChat,
    ]
  )

  const continueSession = useCallback(
    async (opts: {
      messageId: string
      sessionId: string
      url: string
      body: Record<string, unknown>
      statusText: string
      clearFields: Partial<ChatMessage>
      errorFields: Partial<ChatMessage>
      toolName?: string
    }) => {
      updateMessageById(opts.messageId, (m) => ({
        ...m,
        actionStatus: 'pending' as const,
        ...opts.clearFields,
        content: `${opts.toolName || m.toolName} ${opts.statusText}`,
      }))

      commitLoading(true)
      try {
        activeAssistantMsgIdRef.current = generateId()
        startNewAssistantSegmentRef.current = false
        abortControllerRef.current = new AbortController()

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        }
        appendCurrentClusterHeader(headers)
        const response = await fetch(withSubPath(opts.url), {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify(opts.body),
          signal: abortControllerRef.current.signal,
        })

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}))
          throw new Error(
            errData.error || `HTTP error! status: ${response.status}`
          )
        }

        const streamError = await readSSEStream(response)
        if (streamError) {
          updateMessageById(opts.messageId, (m) => ({
            ...m,
            actionStatus: 'error' as const,
            ...opts.errorFields,
            toolResult: streamError,
            content: `${opts.toolName || m.toolName} failed`,
          }))
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          appendAssistantError((error as Error).message)
          updateMessageById(opts.messageId, (m) => ({
            ...m,
            actionStatus: 'error' as const,
            ...opts.errorFields,
            toolResult: (error as Error).message,
            content: `${opts.toolName || m.toolName} failed`,
          }))
        }
      } finally {
        commitLoading(false)
        abortControllerRef.current = null
        activeAssistantMsgIdRef.current = null
        startNewAssistantSegmentRef.current = false
        saveCurrentSession()
      }
    },
    [
      appendAssistantError,
      commitLoading,
      readSSEStream,
      saveCurrentSession,
      updateMessageById,
    ]
  )

  const executeAction = useCallback(
    async (messageId: string) => {
      const msg = messagesRef.current.find((m) => m.id === messageId)
      if (!msg?.pendingAction) return

      const sessionId = msg.pendingAction.sessionId?.trim()
      if (!sessionId) {
        updateMessageById(messageId, (m) => ({
          ...m,
          actionStatus: 'error' as const,
          pendingAction: undefined,
          toolResult:
            'This pending action has expired. Please ask the AI to generate the action again.',
          content: `${msg.toolName} failed`,
        }))
        return
      }

      await continueSession({
        messageId,
        sessionId,
        url: '/api/v1/ai/execute/continue',
        body: { sessionId },
        statusText: 'executing',
        clearFields: { pendingAction: undefined },
        errorFields: {},
        toolName: msg.toolName,
      })
    },
    [continueSession, updateMessageById]
  )

  const submitInput = useCallback(
    async (messageId: string, values: Record<string, unknown>) => {
      const msg = messagesRef.current.find((m) => m.id === messageId)
      if (!msg?.inputRequest) return

      const inputRequest = msg.inputRequest
      const sessionId = inputRequest.sessionId?.trim()
      if (!sessionId) {
        updateMessageById(messageId, (m) => ({
          ...m,
          actionStatus: 'error' as const,
          inputRequest: undefined,
          toolResult:
            'This input request has expired. Please ask the AI again.',
          content: `${msg.toolName} failed`,
        }))
        return
      }

      await continueSession({
        messageId,
        sessionId,
        url: '/api/v1/ai/input/continue',
        body: { sessionId, values },
        statusText: 'submitting',
        clearFields: { inputRequest: undefined },
        errorFields: { inputRequest },
        toolName: msg.toolName,
      })
    },
    [continueSession, updateMessageById]
  )

  const denyAction = useCallback(
    (messageId: string) => {
      updateMessageById(messageId, (m) => ({
        ...m,
        actionStatus: 'denied' as const,
        pendingAction: undefined,
        inputRequest: undefined,
        content: `${m.toolName || 'request'} cancelled`,
      }))
    },
    [updateMessageById]
  )

  const clearMessages = useCallback(() => {
    messagesRef.current = []
    commitMessages(() => [])
    commitCurrentSessionId(null)
    commitLoading(false)
  }, [commitCurrentSessionId, commitLoading, commitMessages])

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    commitLoading(false)
  }, [commitLoading])

  const loadSession = useCallback(
    (sessionId: string) => {
      const session = historyRef.current.find((item) => item.id === sessionId)
      if (!session) return

      messagesRef.current = session.messages
      commitMessages(() => session.messages)
      commitCurrentSessionId(sessionId)
    },
    [commitCurrentSessionId, commitMessages]
  )

  const deleteSession = useCallback(
    (sessionId: string) => {
      const nextHistory = deleteChatSession(historyRef.current, sessionId)
      commitHistory(nextHistory)

      if (currentSessionIdRef.current === sessionId) {
        clearMessages()
      }
    },
    [clearMessages, commitHistory]
  )

  const newSession = useCallback(() => {
    clearMessages()
  }, [clearMessages])

  return {
    messages: state.messages,
    isLoading: state.isLoading,
    history: state.history,
    currentSessionId: state.currentSessionId,
    sendMessage,
    executeAction,
    submitInput,
    denyAction,
    clearMessages,
    stopGeneration,
    loadSession,
    deleteSession,
    newSession,
    ensureSessionId,
    saveCurrentSession,
  }
}
