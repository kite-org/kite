package ai

import (
	"context"
	"encoding/json"
	"strings"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"k8s.io/klog/v2"
)

type anthropicProvider struct {
	client anthropic.Client
}

func (p *anthropicProvider) Stream(
	ctx context.Context,
	request providerRequest,
	sendEvent func(AgentEvent),
) (AgentMessage, error) {
	stream := p.client.Messages.NewStreaming(ctx, anthropic.MessageNewParams{
		Model:     request.Model,
		Messages:  toAnthropicMessages(request.Messages),
		System:    []anthropic.TextBlockParam{{Text: request.SystemPrompt}},
		Tools:     AnthropicToolDefs(request.Tools),
		MaxTokens: int64(request.MaxTokens),
		ToolChoice: anthropic.ToolChoiceUnionParam{
			OfAuto: &anthropic.ToolChoiceAutoParam{},
		},
	})
	return consumeAnthropicStreamingResponse(stream, sendEvent)
}

func toAnthropicMessages(messages []AgentMessage) []anthropic.MessageParam {
	params := make([]anthropic.MessageParam, 0, len(messages))
	for _, message := range messages {
		blocks := make([]anthropic.ContentBlockParamUnion, 0, len(message.Content))
		for _, block := range message.Content {
			switch block.Type {
			case contentBlockText:
				blocks = append(blocks, anthropic.NewTextBlock(block.Text))
			case contentBlockThinking:
				if block.Signature != "" {
					blocks = append(blocks, anthropic.NewThinkingBlock(block.Signature, block.Text))
				}
			case contentBlockRedactedThinking:
				blocks = append(blocks, anthropic.NewRedactedThinkingBlock(block.Data))
			case contentBlockToolCall:
				blocks = append(blocks, anthropic.NewToolUseBlock(block.ToolCallID, block.Arguments, block.ToolName))
			case contentBlockToolResult:
				blocks = append(blocks, anthropic.NewToolResultBlock(block.ToolCallID, block.Text, block.IsError))
			}
		}
		if len(blocks) == 0 {
			continue
		}
		if message.Role == messageRoleAssistant {
			params = append(params, anthropic.NewAssistantMessage(blocks...))
		} else {
			params = append(params, anthropic.NewUserMessage(blocks...))
		}
	}
	return params
}

func consumeAnthropicStreamingResponse(
	stream interface {
		Next() bool
		Current() anthropic.MessageStreamEventUnion
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

	var message anthropic.Message
	for stream.Next() {
		event := stream.Current()
		if err := message.Accumulate(event); err != nil {
			return AgentMessage{}, err
		}

		if startEvent, ok := event.AsAny().(anthropic.ContentBlockStartEvent); ok {
			if thinkingBlock, ok := startEvent.ContentBlock.AsAny().(anthropic.ThinkingBlock); ok && thinkingBlock.Thinking != "" {
				sendEvent(AgentEvent{Type: "message_delta", Data: MessageDeltaEvent{
					BlockType: contentBlockThinking,
					Content:   thinkingBlock.Thinking,
				}})
			}
		}

		if deltaEvent, ok := event.AsAny().(anthropic.ContentBlockDeltaEvent); ok {
			if textDelta, ok := deltaEvent.Delta.AsAny().(anthropic.TextDelta); ok && textDelta.Text != "" {
				sendEvent(AgentEvent{Type: "message_delta", Data: MessageDeltaEvent{
					BlockType: contentBlockText,
					Content:   textDelta.Text,
				}})
			}
			if thinkingDelta, ok := deltaEvent.Delta.AsAny().(anthropic.ThinkingDelta); ok && thinkingDelta.Thinking != "" {
				sendEvent(AgentEvent{Type: "message_delta", Data: MessageDeltaEvent{
					BlockType: contentBlockThinking,
					Content:   thinkingDelta.Thinking,
				}})
			}
		}
	}
	if err := stream.Err(); err != nil {
		return AgentMessage{}, err
	}

	blocks := make([]ContentBlock, 0, len(message.Content))
	for _, content := range message.Content {
		switch block := content.AsAny().(type) {
		case anthropic.TextBlock:
			blocks = append(blocks, ContentBlock{Type: contentBlockText, Text: block.Text})
		case anthropic.ThinkingBlock:
			blocks = append(blocks, ContentBlock{
				Type:      contentBlockThinking,
				Text:      block.Thinking,
				Signature: block.Signature,
			})
		case anthropic.RedactedThinkingBlock:
			blocks = append(blocks, ContentBlock{Type: contentBlockRedactedThinking, Data: block.Data})
		case anthropic.ToolUseBlock:
			rawArguments := strings.TrimSpace(string(block.Input))
			if rawArguments == "" || rawArguments == "null" {
				rawArguments = "{}"
			}
			args := map[string]interface{}{}
			argumentError := ""
			if err := json.Unmarshal([]byte(rawArguments), &args); err != nil {
				argumentError = err.Error()
			}
			blocks = append(blocks, ContentBlock{
				Type:          contentBlockToolCall,
				ToolCallID:    block.ID,
				ToolName:      block.Name,
				Arguments:     args,
				RawArguments:  rawArguments,
				ArgumentError: argumentError,
			})
		}
	}

	return AgentMessage{
		Role:       messageRoleAssistant,
		Content:    blocks,
		StopReason: string(message.StopReason),
	}, nil
}
