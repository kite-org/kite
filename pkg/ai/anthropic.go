package ai

import (
	"context"
	"fmt"
	"strings"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/gin-gonic/gin"
	"k8s.io/klog/v2"
)

func toAnthropicMessages(chatMessages []ChatMessage) []anthropic.MessageParam {
	normalized := normalizeChatMessages(chatMessages)
	messages := make([]anthropic.MessageParam, 0, len(normalized))

	for _, msg := range normalized {
		switch msg.Role {
		case "assistant":
			messages = append(messages, anthropic.NewAssistantMessage(anthropic.NewTextBlock(msg.Content)))
		default:
			messages = append(messages, anthropic.NewUserMessage(anthropic.NewTextBlock(msg.Content)))
		}
	}

	return messages
}

func (a *Agent) processChatAnthropic(c *gin.Context, req *ChatRequest, sendEvent func(SSEEvent)) {
	ctx := c.Request.Context()
	runtimeCtx := buildRuntimePromptContext(c, a.cs)
	language := normalizeLanguage(req.Language)
	if language == "" {
		language = "en"
	}
	sysPrompt := buildContextualSystemPrompt(req.PageContext, runtimeCtx, language)
	messages := toAnthropicMessages(req.Messages)
	a.runAnthropicConversation(ctx, c, sysPrompt, messages, sendEvent)
}

func (a *Agent) continueChatAnthropic(c *gin.Context, session pendingSession, sendEvent func(SSEEvent)) error {
	ctx := c.Request.Context()
	result, isError := ExecuteTool(ctx, c, a.cs, session.ToolCall.Name, session.ToolCall.Args)
	return a.continueChatAnthropicWithToolResult(c, session, result, isError, sendEvent)
}

func (a *Agent) continueChatAnthropicWithToolResult(c *gin.Context, session pendingSession, result string, isError bool, sendEvent func(SSEEvent)) error {
	ctx := c.Request.Context()
	sendEvent(SSEEvent{
		Event: "tool_result",
		Data:  buildToolResultEventData(session.ToolCall.ID, session.ToolCall.Name, result, isError),
	})

	toolResult := result
	if isError {
		toolResult = "Tool error: " + result
	}

	session.AnthropicMessages = append(
		session.AnthropicMessages,
		anthropic.NewUserMessage(
			anthropic.NewToolResultBlock(session.ToolCall.ID, toolResult, isError),
		),
	)
	a.runAnthropicConversation(ctx, c, session.SystemPrompt, session.AnthropicMessages, sendEvent)
	return nil
}

func (a *Agent) runAnthropicConversation(
	ctx context.Context,
	c *gin.Context,
	sysPrompt string,
	messages []anthropic.MessageParam,
	sendEvent func(SSEEvent),
) {
	tools := AnthropicToolDefs(a.cs)

	maxIterations := 100
	for i := 0; i < maxIterations; i++ {
		stream := a.anthropicClient.Messages.NewStreaming(ctx, anthropic.MessageNewParams{
			Model:     a.model,
			Messages:  messages,
			System:    []anthropic.TextBlockParam{{Text: sysPrompt}},
			Tools:     tools,
			MaxTokens: int64(a.maxTokens),
			ToolChoice: anthropic.ToolChoiceUnionParam{
				OfAuto: &anthropic.ToolChoiceAutoParam{},
			},
		})

		_, messageContent, thinkingContent, streamedToolCalls, err := consumeAnthropicStreamingResponse(stream, sendEvent)
		if err != nil {
			klog.Errorf("AI generation error: %v", err)
			sendEvent(SSEEvent{Event: "error", Data: map[string]string{"message": fmt.Sprintf("AI error: %v", err)}})
			return
		}

		if len(streamedToolCalls) == 0 {
			content := strings.TrimSpace(messageContent)
			if content == "" && strings.TrimSpace(thinkingContent) == "" {
				sendEvent(SSEEvent{Event: "error", Data: map[string]string{"message": "AI returned no content"}})
				return
			}
			return
		}

		toolResults := make([]anthropic.ContentBlockParamUnion, 0, len(streamedToolCalls))

		for _, tc := range streamedToolCalls {
			messages = append(messages, streamedToolCallToAnthropicAssistantMessage(tc))

			toolName := tc.Name
			args, err := parseToolCallArguments(tc.Arguments)
			if err != nil {
				klog.Errorf("Failed to parse tool arguments: %v", err)
				toolError := fmt.Sprintf("Failed to parse arguments: %v", err)
				toolResults = append(toolResults, anthropic.NewToolResultBlock(tc.ID, "Tool error: "+toolError, true))
				continue
			}

			sendEvent(SSEEvent{
				Event: "tool_call",
				Data:  buildToolCallEventData(tc, args),
			})

			if InteractionTools[toolName] {
				request, err := parseInteractionRequest(toolName, args)
				if err != nil {
					result := "Error: " + err.Error()
					sendEvent(SSEEvent{
						Event: "tool_result",
						Data:  buildToolResultEventData(tc.ID, toolName, result, true),
					})
					toolResults = append(toolResults, anthropic.NewToolResultBlock(tc.ID, "Tool error: "+result, true))
					continue
				}
				if len(toolResults) > 0 {
					messages = append(messages, anthropic.NewUserMessage(toolResults...))
					toolResults = nil
				}
				sessionID := agentPendingSessions.save(pendingSession{
					Provider:          a.provider,
					SystemPrompt:      sysPrompt,
					AnthropicMessages: append([]anthropic.MessageParam(nil), messages...),
					ToolCall: pendingToolCall{
						ID:   tc.ID,
						Name: toolName,
						Args: args,
					},
				})
				if sessionID == "" {
					errorMsg := "Failed to save pending session"
					toolResults = append(toolResults, anthropic.NewToolResultBlock(tc.ID, "Tool error: "+errorMsg, true))
					continue
				}
				sendEvent(SSEEvent{
					Event: "input_required",
					Data:  buildInteractionEventData(toolName, tc.ID, sessionID, request),
				})
				return
			}

			if MutationTools[toolName] {
				result, isError := AuthorizeTool(c, a.cs, toolName, args)
				if isError {
					sendEvent(SSEEvent{
						Event: "tool_result",
						Data:  buildToolResultEventData(tc.ID, toolName, result, true),
					})
					toolResults = append(toolResults, anthropic.NewToolResultBlock(tc.ID, "Tool error: "+result, true))
					continue
				}
				if len(toolResults) > 0 {
					messages = append(messages, anthropic.NewUserMessage(toolResults...))
				}
				sessionID := agentPendingSessions.save(pendingSession{
					Provider:          a.provider,
					SystemPrompt:      sysPrompt,
					AnthropicMessages: append([]anthropic.MessageParam(nil), messages...),
					ToolCall: pendingToolCall{
						ID:   tc.ID,
						Name: toolName,
						Args: args,
					},
				})
				if sessionID == "" {
					errorMsg := "Failed to save pending session"
					toolResults = append(toolResults, anthropic.NewToolResultBlock(tc.ID, "Tool error: "+errorMsg, true))
					continue
				}
				sendEvent(SSEEvent{
					Event: "action_required",
					Data:  buildActionRequiredEventData(tc, sessionID, args),
				})
				return
			}

			result, isError := ExecuteTool(ctx, c, a.cs, toolName, args)

			sendEvent(SSEEvent{
				Event: "tool_result",
				Data:  buildToolResultEventData(tc.ID, toolName, result, isError),
			})

			if isError {
				result = "Tool error: " + result
			}
			toolResults = append(toolResults, anthropic.NewToolResultBlock(tc.ID, result, isError))
		}

		if len(toolResults) > 0 {
			messages = append(messages, anthropic.NewUserMessage(toolResults...))
		}
	}

	sendEvent(SSEEvent{Event: "error", Data: map[string]string{"message": "Too many tool calling iterations"}})
}

func consumeAnthropicStreamingResponse(
	stream interface {
		Next() bool
		Current() anthropic.MessageStreamEventUnion
		Err() error
		Close() error
	},
	sendEvent func(SSEEvent),
) (anthropic.Message, string, string, []streamedToolCall, error) {
	defer func() {
		if err := stream.Close(); err != nil {
			klog.Warningf("Failed to close AI stream: %v", err)
		}
	}()

	var message anthropic.Message
	var contentBuilder strings.Builder
	var thinkingBuilder strings.Builder

	for stream.Next() {
		event := stream.Current()
		if err := message.Accumulate(event); err != nil {
			return anthropic.Message{}, "", "", nil, err
		}

		if startEvent, ok := event.AsAny().(anthropic.ContentBlockStartEvent); ok {
			if thinkingBlock, ok := startEvent.ContentBlock.AsAny().(anthropic.ThinkingBlock); ok && thinkingBlock.Thinking != "" {
				thinkingBuilder.WriteString(thinkingBlock.Thinking)
				sendEvent(SSEEvent{Event: "think", Data: map[string]string{"content": thinkingBlock.Thinking}})
			}
		}

		if deltaEvent, ok := event.AsAny().(anthropic.ContentBlockDeltaEvent); ok {
			if textDelta, ok := deltaEvent.Delta.AsAny().(anthropic.TextDelta); ok && textDelta.Text != "" {
				contentBuilder.WriteString(textDelta.Text)
				sendEvent(SSEEvent{Event: "message", Data: map[string]string{"content": textDelta.Text}})
			}
			if thinkingDelta, ok := deltaEvent.Delta.AsAny().(anthropic.ThinkingDelta); ok && thinkingDelta.Thinking != "" {
				thinkingBuilder.WriteString(thinkingDelta.Thinking)
				sendEvent(SSEEvent{Event: "think", Data: map[string]string{"content": thinkingDelta.Thinking}})
			}
		}
	}

	if err := stream.Err(); err != nil {
		return anthropic.Message{}, "", "", nil, err
	}

	toolCalls := anthropicToolCallsToStreamedToolCalls(message)
	content := contentBuilder.String()
	if content == "" {
		content = anthropicMessageText(message)
	}
	thinking := thinkingBuilder.String()
	if thinking == "" {
		thinking = anthropicMessageThinking(message)
	}

	return message, content, thinking, toolCalls, nil
}

func anthropicToolCallsToStreamedToolCalls(message anthropic.Message) []streamedToolCall {
	toolCalls := make([]streamedToolCall, 0)
	for idx, block := range message.Content {
		toolUse, ok := block.AsAny().(anthropic.ToolUseBlock)
		if !ok {
			continue
		}
		arguments := strings.TrimSpace(string(toolUse.Input))
		if arguments == "" || arguments == "null" {
			arguments = "{}"
		}
		toolCalls = append(toolCalls, streamedToolCall{
			Index:     int64(idx),
			ID:        toolUse.ID,
			Name:      toolUse.Name,
			Arguments: arguments,
		})
	}
	return toolCalls
}

func anthropicMessageText(message anthropic.Message) string {
	var contentBuilder strings.Builder
	for _, block := range message.Content {
		textBlock, ok := block.AsAny().(anthropic.TextBlock)
		if !ok || textBlock.Text == "" {
			continue
		}
		contentBuilder.WriteString(textBlock.Text)
	}
	return contentBuilder.String()
}

func anthropicMessageThinking(message anthropic.Message) string {
	var thinkingBuilder strings.Builder
	for _, block := range message.Content {
		thinkingBlock, ok := block.AsAny().(anthropic.ThinkingBlock)
		if !ok || thinkingBlock.Thinking == "" {
			continue
		}
		thinkingBuilder.WriteString(thinkingBlock.Thinking)
	}
	return thinkingBuilder.String()
}

func streamedToolCallToAnthropicAssistantMessage(tc streamedToolCall) anthropic.MessageParam {
	input := map[string]interface{}{}
	if args, err := parseToolCallArguments(tc.Arguments); err == nil {
		input = args
	}
	return anthropic.NewAssistantMessage(
		anthropic.NewToolUseBlock(tc.ID, input, tc.Name),
	)
}
