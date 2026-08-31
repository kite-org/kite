package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	messageRoleUser      = "user"
	messageRoleAssistant = "assistant"
	messageRoleTool      = "tool"

	contentBlockText             = "text"
	contentBlockThinking         = "thinking"
	contentBlockRedactedThinking = "redacted_thinking"
	contentBlockToolCall         = "tool_call"
	contentBlockToolResult       = "tool_result"
)

type AgentMessage struct {
	Role       string         `json:"role"`
	Content    []ContentBlock `json:"content"`
	StopReason string         `json:"stop_reason,omitempty"`
}

type ContentBlock struct {
	Type          string                 `json:"type"`
	Text          string                 `json:"text,omitempty"`
	Signature     string                 `json:"signature,omitempty"`
	Data          string                 `json:"data,omitempty"`
	ToolCallID    string                 `json:"tool_call_id,omitempty"`
	ToolName      string                 `json:"tool_name,omitempty"`
	Arguments     map[string]interface{} `json:"arguments,omitempty"`
	RawArguments  string                 `json:"raw_arguments,omitempty"`
	ArgumentError string                 `json:"argument_error,omitempty"`
	IsError       bool                   `json:"is_error,omitempty"`
}

type ToolCall struct {
	ID            string                 `json:"id"`
	Name          string                 `json:"name"`
	Arguments     map[string]interface{} `json:"arguments,omitempty"`
	RawArguments  string                 `json:"raw_arguments,omitempty"`
	ArgumentError string                 `json:"argument_error,omitempty"`
	Index         int64                  `json:"-"`
}

type ToolResult struct {
	ToolCallID string `json:"tool_call_id"`
	ToolName   string `json:"tool_name"`
	Content    string `json:"content"`
	IsError    bool   `json:"is_error"`
}

type ChatRequest struct {
	Messages    []AgentMessage `json:"messages"`
	Language    string         `json:"language,omitempty"`
	PageContext *PageContext   `json:"page_context"`
}

type AgentEvent struct {
	Type string      `json:"-"`
	Data interface{} `json:"-"`
}

type MessageDeltaEvent struct {
	BlockType string `json:"block_type"`
	Content   string `json:"content"`
}

type MessageEndEvent struct {
	Message AgentMessage `json:"message"`
}

type ToolCallEvent struct {
	ToolCall ToolCall `json:"tool_call"`
}

type ToolResultEvent struct {
	ToolResult ToolResult `json:"tool_result"`
}

type ConfirmationRequiredEvent struct {
	SessionID string   `json:"session_id"`
	ToolCall  ToolCall `json:"tool_call"`
}

type InputRequiredEvent struct {
	SessionID string             `json:"session_id"`
	ToolCall  ToolCall           `json:"tool_call"`
	Input     interactionRequest `json:"input"`
}

type ErrorEvent struct {
	Message string `json:"message"`
}

type providerRequest struct {
	SystemPrompt string
	Messages     []AgentMessage
	Tools        []agentToolDefinition
	Model        string
	MaxTokens    int
}

type modelProvider interface {
	Stream(context.Context, providerRequest, func(AgentEvent)) (AgentMessage, error)
}

func (m AgentMessage) toolCalls() []ToolCall {
	calls := make([]ToolCall, 0)
	for _, block := range m.Content {
		if block.Type != contentBlockToolCall {
			continue
		}
		calls = append(calls, ToolCall{
			ID:            block.ToolCallID,
			Name:          block.ToolName,
			Arguments:     block.Arguments,
			RawArguments:  block.RawArguments,
			ArgumentError: block.ArgumentError,
		})
	}
	return calls
}

func (m AgentMessage) hasContent() bool {
	for _, block := range m.Content {
		switch block.Type {
		case contentBlockText, contentBlockThinking:
			if strings.TrimSpace(block.Text) != "" {
				return true
			}
		case contentBlockRedactedThinking, contentBlockToolCall, contentBlockToolResult:
			return true
		}
	}
	return false
}

func toolResultBlock(result ToolResult) ContentBlock {
	return ContentBlock{
		Type:       contentBlockToolResult,
		Text:       result.Content,
		ToolCallID: result.ToolCallID,
		ToolName:   result.ToolName,
		IsError:    result.IsError,
	}
}

func normalizeAgentMessages(messages []AgentMessage) []AgentMessage {
	if len(messages) > maxConversationMessages {
		messages = messages[len(messages)-maxConversationMessages:]
	}

	normalized := make([]AgentMessage, 0, len(messages))
	for _, message := range messages {
		if message.Role != messageRoleAssistant && message.Role != messageRoleTool {
			message.Role = messageRoleUser
		}

		blocks := make([]ContentBlock, 0, len(message.Content))
		for _, block := range message.Content {
			switch block.Type {
			case contentBlockText:
				if message.Role == messageRoleTool {
					continue
				}
				block.Text = strings.TrimSpace(block.Text)
				if block.Text == "" {
					continue
				}
				if len(block.Text) > maxMessageChars {
					block.Text = block.Text[:maxMessageChars]
				}
			case contentBlockThinking:
				if message.Role != messageRoleAssistant {
					continue
				}
				if block.Signature == "" {
					block.Text = strings.TrimSpace(block.Text)
					if len(block.Text) > maxMessageChars {
						block.Text = block.Text[:maxMessageChars]
					}
				}
				if block.Text == "" {
					continue
				}
			case contentBlockRedactedThinking:
				if message.Role != messageRoleAssistant || block.Data == "" {
					continue
				}
			case contentBlockToolCall:
				if message.Role != messageRoleAssistant || block.ToolCallID == "" || block.ToolName == "" {
					continue
				}
			case contentBlockToolResult:
				if message.Role != messageRoleTool || block.ToolCallID == "" || block.ToolName == "" {
					continue
				}
				if len(block.Text) > maxMessageChars {
					block.Text = block.Text[:maxMessageChars]
				}
			default:
				continue
			}
			blocks = append(blocks, block)
		}
		if len(blocks) == 0 {
			continue
		}
		message.Content = blocks
		normalized = append(normalized, message)
	}
	for len(normalized) > 0 && normalized[0].Role == messageRoleTool {
		normalized = normalized[1:]
	}
	return normalized
}

func parseToolCallArguments(raw string) (map[string]interface{}, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return map[string]interface{}{}, nil
	}

	args := map[string]interface{}{}
	if err := json.Unmarshal([]byte(raw), &args); err != nil {
		return nil, err
	}
	return args, nil
}

func MarshalSSEEvent(event AgentEvent) string {
	data, err := json.Marshal(event.Data)
	if err != nil {
		return "event: error\ndata: {\"message\":\"marshal error\"}\n\n"
	}
	return fmt.Sprintf("event: %s\ndata: %s\n\n", event.Type, string(data))
}
