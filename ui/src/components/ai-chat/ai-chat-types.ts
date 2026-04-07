export type ChatRole = 'user' | 'assistant' | 'tool'

export interface ChatInputOption {
  label: string
  value: string
  description?: string
}

export interface ChatInputField {
  name: string
  label: string
  type: 'text' | 'number' | 'textarea' | 'select' | 'switch'
  required?: boolean
  placeholder?: string
  description?: string
  defaultValue?: string
  options?: ChatInputOption[]
}

export interface ChatInputRequest {
  sessionId: string
  kind: 'choice' | 'form'
  name?: string
  title: string
  description?: string
  submitLabel?: string
  options?: ChatInputOption[]
  fields?: ChatInputField[]
}

export interface ChatPendingAction {
  sessionId: string
  tool: string
  args: Record<string, unknown>
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  thinking?: string
  toolCallId?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolResult?: string
  inputRequest?: ChatInputRequest
  pendingAction?: ChatPendingAction
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

export type APIChatMessage = { role: 'user' | 'assistant'; content: string }

export interface AIChatState {
  messages: ChatMessage[]
  history: ChatSession[]
  currentSessionId: string | null
  isLoading: boolean
}
