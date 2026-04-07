import { AIChatState, ChatMessage, ChatSession } from './ai-chat-types'

const HISTORY_STORAGE_KEY_PREFIX = 'ai-chat-history-'
const MAX_HISTORY_SESSIONS = 50

export const initialAIChatState: AIChatState = {
  messages: [],
  history: [],
  currentSessionId: null,
  isLoading: false,
}

export type AIChatAction =
  | { type: 'messages/set'; messages: ChatMessage[] }
  | { type: 'history/set'; history: ChatSession[] }
  | { type: 'session/set'; sessionId: string | null }
  | { type: 'loading/set'; isLoading: boolean }

export function aiChatReducer(
  state: AIChatState,
  action: AIChatAction
): AIChatState {
  switch (action.type) {
    case 'messages/set':
      return { ...state, messages: action.messages }
    case 'history/set':
      return { ...state, history: action.history }
    case 'session/set':
      return { ...state, currentSessionId: action.sessionId }
    case 'loading/set':
      return { ...state, isLoading: action.isLoading }
    default:
      return state
  }
}

export function loadHistoryFromStorage(username: string): ChatSession[] {
  try {
    const key = `${HISTORY_STORAGE_KEY_PREFIX}${username || 'anonymous'}`
    const stored = localStorage.getItem(key)
    if (!stored) return []
    return JSON.parse(stored) as ChatSession[]
  } catch {
    return []
  }
}

export function saveHistoryToStorage(
  username: string,
  sessions: ChatSession[]
) {
  try {
    const key = `${HISTORY_STORAGE_KEY_PREFIX}${username || 'anonymous'}`
    localStorage.setItem(key, JSON.stringify(sessions))
  } catch {
    // ignore storage errors
  }
}

// TODO: generate session title with AI to better summarize the conversation, instead of just using the first user message
export function generateSessionTitle(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user')
  if (!firstUserMessage) return 'New Chat'
  const content = firstUserMessage.content.trim()
  return content.length > 50 ? `${content.slice(0, 50)}...` : content
}

export function upsertChatSession(
  history: ChatSession[],
  sessionId: string,
  sessionMessages: ChatMessage[],
  clusterName: string
): ChatSession[] {
  if (!sessionId || sessionMessages.length === 0) return history

  const now = Date.now()
  const title = generateSessionTitle(sessionMessages)
  const existingIndex = history.findIndex((session) => session.id === sessionId)
  const createdAt = existingIndex >= 0 ? history[existingIndex].createdAt : now
  const session: ChatSession = {
    id: sessionId,
    title,
    messages: sessionMessages,
    createdAt,
    updatedAt: now,
    clusterName,
  }

  let nextHistory: ChatSession[]
  if (existingIndex >= 0) {
    nextHistory = [...history]
    nextHistory[existingIndex] = session
  } else {
    nextHistory = [session, ...history]
  }

  if (nextHistory.length > MAX_HISTORY_SESSIONS) {
    nextHistory = nextHistory.slice(0, MAX_HISTORY_SESSIONS)
  }

  return nextHistory
}

export function deleteChatSession(
  history: ChatSession[],
  sessionId: string
): ChatSession[] {
  return history.filter((session) => session.id !== sessionId)
}
