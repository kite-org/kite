package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/openai/openai-go"
	"k8s.io/klog/v2"
)

func toOpenAIMessages(systemPrompt string, chatMessages []ChatMessage) []openai.ChatCompletionMessageParamUnion {
	normalized := normalizeChatMessages(chatMessages)
	messages := make([]openai.ChatCompletionMessageParamUnion, 0, len(normalized)+1)
	messages = append(messages, openai.SystemMessage(systemPrompt))

	for _, msg := range normalized {
		switch msg.Role {
		case "assistant":
			messages = append(messages, openai.AssistantMessage(msg.Content))
		default:
			messages = append(messages, openai.UserMessage(msg.Content))
		}
	}

	return messages
}

func (a *Agent) processChatOpenAI(c *gin.Context, req *ChatRequest, sendEvent func(SSEEvent)) {
	ctx := c.Request.Context()
	runtimeCtx := buildRuntimePromptContext(c, a.cs)
	language := normalizeLanguage(req.Language)
	if language == "" {
		language = "en"
	}
	sysPrompt := buildContextualSystemPrompt(req.PageContext, runtimeCtx, language)
	messages := toOpenAIMessages(sysPrompt, req.Messages)
	a.runOpenAIConversation(ctx, c, messages, sendEvent)
}

func (a *Agent) continueChatOpenAI(c *gin.Context, session pendingSession, sendEvent func(SSEEvent)) error {
	ctx := c.Request.Context()
	result, isError := ExecuteTool(ctx, c, a.cs, session.ToolCall.Name, session.ToolCall.Args)
	return a.continueChatOpenAIWithToolResult(c, session, result, isError, sendEvent)
}

func (a *Agent) continueChatOpenAIWithToolResult(c *gin.Context, session pendingSession, result string, isError bool, sendEvent func(SSEEvent)) error {
	ctx := c.Request.Context()
	sendEvent(SSEEvent{
		Event: "tool_result",
		Data:  buildToolResultEventData(session.ToolCall.ID, session.ToolCall.Name, result, isError),
	})

	if isError {
		result = "Tool error: " + result
	}

	session.OpenAIMessages = append(session.OpenAIMessages, openai.ToolMessage(result, session.ToolCall.ID))
	a.runOpenAIConversation(ctx, c, session.OpenAIMessages, sendEvent)
	return nil
}

func (a *Agent) runOpenAIConversation(
	ctx context.Context,
	c *gin.Context,
	messages []openai.ChatCompletionMessageParamUnion,
	sendEvent func(SSEEvent),
) {
	tools := OpenAIToolDefs(a.cs)

	maxIterations := 100
	for i := 0; i < maxIterations; i++ {
		stream := a.openaiClient.Chat.Completions.NewStreaming(ctx, openai.ChatCompletionNewParams{
			Model:    a.model,
			Messages: messages,
			Tools:    tools,
			ToolChoice: openai.ChatCompletionToolChoiceOptionUnionParam{
				OfAuto: openai.String("auto"),
			},
			MaxCompletionTokens: openai.Int(int64(a.maxTokens)),
		})
		messageContent, refusal, thinkingContent, streamedToolCalls, err := consumeStreamingResponse(stream, sendEvent)
		if err != nil {
			klog.Errorf("AI generation error: %v", err)
			sendEvent(SSEEvent{Event: "error", Data: map[string]string{"message": fmt.Sprintf("AI error: %v", err)}})
			return
		}

		if len(streamedToolCalls) == 0 {
			content := messageContent
			if content == "" {
				content = refusal
				if content != "" {
					sendEvent(SSEEvent{Event: "message", Data: map[string]string{"content": content}})
				}
			}
			if content == "" && thinkingContent == "" {
				sendEvent(SSEEvent{Event: "error", Data: map[string]string{"message": "AI returned no content"}})
				return
			}
			return
		}

		for _, tc := range streamedToolCalls {
			messages = append(messages, streamedToolCallsToAssistantMessage([]streamedToolCall{tc}))

			toolName := tc.Name
			args, err := parseToolCallArguments(tc.Arguments)
			if err != nil {
				klog.Errorf("Failed to parse tool arguments: %v", err)
				toolError := fmt.Sprintf("Failed to parse arguments: %v", err)
				messages = append(messages, openai.ToolMessage(toolError, tc.ID))
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
					messages = append(messages, openai.ToolMessage("Tool error: "+result, tc.ID))
					continue
				}

				sessionID := agentPendingSessions.save(pendingSession{
					Provider:       a.provider,
					OpenAIMessages: append([]openai.ChatCompletionMessageParamUnion(nil), messages...),
					ToolCall: pendingToolCall{
						ID:   tc.ID,
						Name: toolName,
						Args: args,
					},
				})
				if sessionID == "" {
					errorMsg := "Failed to save pending session"
					messages = append(messages, openai.ToolMessage("Tool error: "+errorMsg, tc.ID))
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
					messages = append(messages, openai.ToolMessage("Tool error: "+result, tc.ID))
					continue
				}
				sessionID := agentPendingSessions.save(pendingSession{
					Provider:       a.provider,
					OpenAIMessages: append([]openai.ChatCompletionMessageParamUnion(nil), messages...),
					ToolCall: pendingToolCall{
						ID:   tc.ID,
						Name: toolName,
						Args: args,
					},
				})
				if sessionID == "" {
					errorMsg := "Failed to save pending session"
					messages = append(messages, openai.ToolMessage("Tool error: "+errorMsg, tc.ID))
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
			messages = append(messages, openai.ToolMessage(result, tc.ID))
		}
	}

	sendEvent(SSEEvent{Event: "error", Data: map[string]string{"message": "Too many tool calling iterations"}})
}

func consumeStreamingResponse(
	stream interface {
		Next() bool
		Current() openai.ChatCompletionChunk
		Err() error
		Close() error
	},
	sendEvent func(SSEEvent),
) (string, string, string, []streamedToolCall, error) {
	defer func() {
		if err := stream.Close(); err != nil {
			klog.Warningf("Failed to close AI stream: %v", err)
		}
	}()

	var contentBuilder strings.Builder
	var refusalBuilder strings.Builder
	var thinkingBuilder strings.Builder
	toolCallMap := make(map[int64]*streamedToolCall)

	for stream.Next() {
		chunk := stream.Current()
		for _, choice := range chunk.Choices {
			delta := choice.Delta

			if delta.Content != "" {
				contentBuilder.WriteString(delta.Content)
				sendEvent(SSEEvent{Event: "message", Data: map[string]string{"content": delta.Content}})
			}
			if delta.Refusal != "" {
				refusalBuilder.WriteString(delta.Refusal)
			}
			if thinking := extractOpenAIThinkingDelta(delta); thinking != "" {
				thinkingBuilder.WriteString(thinking)
				sendEvent(SSEEvent{Event: "think", Data: map[string]string{"content": thinking}})
			}

			for _, tc := range delta.ToolCalls {
				item, exists := toolCallMap[tc.Index]
				if !exists {
					item = &streamedToolCall{Index: tc.Index}
					toolCallMap[tc.Index] = item
				}
				if tc.ID != "" {
					item.ID = tc.ID
				}
				if tc.Function.Name != "" {
					item.Name = tc.Function.Name
				}
				if tc.Function.Arguments != "" {
					item.Arguments += tc.Function.Arguments
				}
			}
		}
	}

	if err := stream.Err(); err != nil {
		return "", "", "", nil, err
	}

	toolCalls := make([]streamedToolCall, 0, len(toolCallMap))
	for _, tc := range toolCallMap {
		if tc.ID == "" {
			tc.ID = fmt.Sprintf("tool_call_%d", tc.Index)
		}
		toolCalls = append(toolCalls, *tc)
	}
	sort.Slice(toolCalls, func(i, j int) bool {
		return toolCalls[i].Index < toolCalls[j].Index
	})

	return contentBuilder.String(), refusalBuilder.String(), thinkingBuilder.String(), toolCalls, nil
}

func extractOpenAIThinkingDelta(delta openai.ChatCompletionChunkChoiceDelta) string {
	if len(delta.JSON.ExtraFields) == 0 {
		return ""
	}

	keys := []string{
		"reasoning_content",
		"reasoning",
		"thinking",
		"thinking_content",
		"reasoning_text",
	}
	for _, key := range keys {
		field, ok := delta.JSON.ExtraFields[key]
		if !ok {
			continue
		}
		if text := extractThinkingTextFromRaw(field.Raw()); text != "" {
			return text
		}
	}

	for key, field := range delta.JSON.ExtraFields {
		normalizedKey := strings.ToLower(key)
		if !strings.Contains(normalizedKey, "think") && !strings.Contains(normalizedKey, "reason") {
			continue
		}
		if text := extractThinkingTextFromRaw(field.Raw()); text != "" {
			return text
		}
	}

	return ""
}

func extractThinkingTextFromRaw(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" {
		return ""
	}

	var value interface{}
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return ""
	}
	return extractThinkingTextFromAny(value)
}

func extractThinkingTextFromAny(value interface{}) string {
	switch v := value.(type) {
	case string:
		return v
	case map[string]interface{}:
		keys := []string{
			"thinking",
			"reasoning_content",
			"reasoning",
			"text",
			"content",
			"output_text",
			"delta",
		}
		for _, key := range keys {
			child, ok := v[key]
			if !ok {
				continue
			}
			if text := extractThinkingTextFromAny(child); text != "" {
				return text
			}
		}
	case []interface{}:
		var builder strings.Builder
		for _, item := range v {
			text := extractThinkingTextFromAny(item)
			if text == "" {
				continue
			}
			builder.WriteString(text)
		}
		return builder.String()
	}

	return ""
}

func streamedToolCallsToAssistantMessage(toolCalls []streamedToolCall) openai.ChatCompletionMessageParamUnion {
	params := make([]openai.ChatCompletionMessageToolCallParam, 0, len(toolCalls))
	for _, tc := range toolCalls {
		params = append(params, openai.ChatCompletionMessageToolCallParam{
			ID: tc.ID,
			Function: openai.ChatCompletionMessageToolCallFunctionParam{
				Name:      tc.Name,
				Arguments: tc.Arguments,
			},
		})
	}

	assistant := openai.ChatCompletionAssistantMessageParam{
		ToolCalls: params,
	}
	return openai.ChatCompletionMessageParamUnion{OfAssistant: &assistant}
}
