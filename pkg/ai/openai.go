package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/openai/openai-go"
	"k8s.io/klog/v2"
)

type openAIProvider struct {
	client openai.Client
}

func (p *openAIProvider) Stream(
	ctx context.Context,
	request providerRequest,
	sendEvent func(AgentEvent),
) (AgentMessage, error) {
	stream := p.client.Chat.Completions.NewStreaming(ctx, openai.ChatCompletionNewParams{
		Model:    request.Model,
		Messages: toOpenAIMessages(request.SystemPrompt, request.Messages),
		Tools:    OpenAIToolDefs(request.Tools),
		ToolChoice: openai.ChatCompletionToolChoiceOptionUnionParam{
			OfAuto: openai.String("auto"),
		},
		MaxCompletionTokens: openai.Int(int64(request.MaxTokens)),
	})
	return consumeOpenAIStreamingResponse(stream, sendEvent)
}

func toOpenAIMessages(systemPrompt string, messages []AgentMessage) []openai.ChatCompletionMessageParamUnion {
	params := make([]openai.ChatCompletionMessageParamUnion, 0, len(messages)+1)
	params = append(params, openai.SystemMessage(systemPrompt))

	for _, message := range messages {
		switch message.Role {
		case messageRoleAssistant:
			params = append(params, toOpenAIAssistantMessage(message))
		case messageRoleTool:
			for _, block := range message.Content {
				if block.Type == contentBlockToolResult {
					params = append(params, openai.ToolMessage(block.Text, block.ToolCallID))
				}
			}
		default:
			params = append(params, openai.UserMessage(messageText(message)))
		}
	}
	return params
}

func toOpenAIAssistantMessage(message AgentMessage) openai.ChatCompletionMessageParamUnion {
	var textBuilder strings.Builder
	var thinkingBuilder strings.Builder
	toolCalls := make([]openai.ChatCompletionMessageToolCallParam, 0)

	for _, block := range message.Content {
		switch block.Type {
		case contentBlockText:
			textBuilder.WriteString(block.Text)
		case contentBlockThinking:
			thinkingBuilder.WriteString(block.Text)
		case contentBlockToolCall:
			toolCalls = append(toolCalls, openai.ChatCompletionMessageToolCallParam{
				ID: block.ToolCallID,
				Function: openai.ChatCompletionMessageToolCallFunctionParam{
					Name:      block.ToolName,
					Arguments: serializedToolArguments(block.RawArguments, block.Arguments),
				},
			})
		}
	}

	param := openai.AssistantMessage(textBuilder.String())
	if len(toolCalls) > 0 {
		param.OfAssistant.ToolCalls = toolCalls
	}
	if thinkingBuilder.Len() > 0 {
		param.OfAssistant.SetExtraFields(map[string]any{"reasoning_content": thinkingBuilder.String()})
	}
	return param
}

func consumeOpenAIStreamingResponse(
	stream interface {
		Next() bool
		Current() openai.ChatCompletionChunk
		Err() error
		Close() error
	},
	sendEvent func(AgentEvent),
) (AgentMessage, error) {
	defer func() {
		if err := stream.Close(); err != nil {
			klog.Warningf("Failed to close AI stream: %v", err)
		}
	}()

	var contentBuilder strings.Builder
	var refusalBuilder strings.Builder
	var thinkingBuilder strings.Builder
	toolCallMap := make(map[int64]*ToolCall)
	stopReason := ""

	for stream.Next() {
		chunk := stream.Current()
		for _, choice := range chunk.Choices {
			delta := choice.Delta
			if choice.FinishReason != "" {
				stopReason = choice.FinishReason
			}

			if delta.Content != "" {
				contentBuilder.WriteString(delta.Content)
				sendEvent(AgentEvent{Type: "message_delta", Data: MessageDeltaEvent{
					BlockType: contentBlockText,
					Content:   delta.Content,
				}})
			}
			if delta.Refusal != "" {
				refusalBuilder.WriteString(delta.Refusal)
			}
			if thinking := extractOpenAIThinkingDelta(delta); thinking != "" {
				thinkingBuilder.WriteString(thinking)
				sendEvent(AgentEvent{Type: "message_delta", Data: MessageDeltaEvent{
					BlockType: contentBlockThinking,
					Content:   thinking,
				}})
			}

			for _, streamed := range delta.ToolCalls {
				toolCall, exists := toolCallMap[streamed.Index]
				if !exists {
					toolCall = &ToolCall{Index: streamed.Index}
					toolCallMap[streamed.Index] = toolCall
				}
				if streamed.ID != "" {
					toolCall.ID = streamed.ID
				}
				if streamed.Function.Name != "" {
					toolCall.Name = streamed.Function.Name
				}
				toolCall.RawArguments += streamed.Function.Arguments
			}
		}
	}
	if err := stream.Err(); err != nil {
		return AgentMessage{}, err
	}

	content := contentBuilder.String()
	if content == "" && refusalBuilder.Len() > 0 {
		content = refusalBuilder.String()
		sendEvent(AgentEvent{Type: "message_delta", Data: MessageDeltaEvent{
			BlockType: contentBlockText,
			Content:   content,
		}})
	}

	toolCalls := make([]ToolCall, 0, len(toolCallMap))
	for _, toolCall := range toolCallMap {
		if toolCall.ID == "" {
			toolCall.ID = fmt.Sprintf("tool_call_%d", toolCall.Index)
		}
		args, err := parseToolCallArguments(toolCall.RawArguments)
		if err != nil {
			toolCall.ArgumentError = err.Error()
		} else {
			toolCall.Arguments = args
		}
		toolCalls = append(toolCalls, *toolCall)
	}
	sort.Slice(toolCalls, func(i, j int) bool {
		return toolCalls[i].Index < toolCalls[j].Index
	})

	blocks := make([]ContentBlock, 0, len(toolCalls)+2)
	if thinkingBuilder.Len() > 0 {
		blocks = append(blocks, ContentBlock{Type: contentBlockThinking, Text: thinkingBuilder.String()})
	}
	if content != "" {
		blocks = append(blocks, ContentBlock{Type: contentBlockText, Text: content})
	}
	for _, toolCall := range toolCalls {
		blocks = append(blocks, ContentBlock{
			Type:          contentBlockToolCall,
			ToolCallID:    toolCall.ID,
			ToolName:      toolCall.Name,
			Arguments:     toolCall.Arguments,
			RawArguments:  toolCall.RawArguments,
			ArgumentError: toolCall.ArgumentError,
		})
	}

	return AgentMessage{Role: messageRoleAssistant, Content: blocks, StopReason: stopReason}, nil
}

func messageText(message AgentMessage) string {
	var builder strings.Builder
	for _, block := range message.Content {
		if block.Type == contentBlockText {
			builder.WriteString(block.Text)
		}
	}
	return builder.String()
}

func serializedToolArguments(raw string, args map[string]interface{}) string {
	if strings.TrimSpace(raw) != "" {
		return raw
	}
	data, err := json.Marshal(args)
	if err != nil || len(data) == 0 {
		return "{}"
	}
	return string(data)
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
		if text := extractThinkingFromRaw(field.Raw()); text != "" {
			return text
		}
	}

	for key, field := range delta.JSON.ExtraFields {
		normalizedKey := strings.ToLower(key)
		if !strings.Contains(normalizedKey, "think") && !strings.Contains(normalizedKey, "reason") {
			continue
		}
		if text := extractThinkingFromRaw(field.Raw()); text != "" {
			return text
		}
	}

	return ""
}

func extractThinkingFromRaw(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "null" {
		return ""
	}

	var text string
	if err := json.Unmarshal([]byte(trimmed), &text); err == nil {
		return text
	}
	return raw
}
