package ai

import (
	"context"
	"encoding/json"
	"strings"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/zxh326/kite/pkg/model"
	"k8s.io/klog/v2"
)

// anthropicProvider talks to the Beta Messages API rather than the stable one.
// The beta surface is what carries output effort, adaptive thinking, and context
// management; on the stable surface those requests are simply not expressible.
type anthropicProvider struct {
	client anthropic.Client
}

// legacyAnthropicModelMarkers identifies models that predate the Opus-4.6-era
// request surface and 400 on output effort / adaptive thinking / context
// management. Markers are matched as substrings against a separator-normalized
// ID (see normalizeAnthropicModelID), so dotted gateway aliases
// ("claude-3.5-sonnet") and Vertex dated snapshots ("claude-sonnet-4@20250514")
// match the same markers as the first-party hyphen form. "haiku" is deliberately
// broad: a future Haiku is more likely to follow the small-model tier, and being
// wrong there costs a missed optimization rather than a failed request.
var legacyAnthropicModelMarkers = []string{
	"opus-4-5", "opus-4-1", "opus-4-0", "opus-4-20",
	"sonnet-4-5", "sonnet-4-0", "sonnet-4-20",
	"claude-3-", "claude-2-", "claude-v2", "claude-v1", "claude-instant", "haiku",
}

// normalizeAnthropicModelID folds the separator variants the same model ID
// appears under across first-party, Bedrock, Vertex, and OpenAI-compatible
// gateways ('.', '@', ':', '/', '_') to '-', so one marker matches all of them.
// A trailing "-latest"/"-v1"-style suffix is left alone; markers are prefixes of
// the version segment, not anchored at the end.
func normalizeAnthropicModelID(modelName string) string {
	m := strings.ToLower(strings.TrimSpace(modelName))
	for _, sep := range []string{".", "@", ":", "/", "_"} {
		m = strings.ReplaceAll(m, sep, "-")
	}
	return m
}

// anthropicModelSupportsModernFeatures reports whether the configured model
// accepts the Opus-4.6-era request surface: output effort, adaptive thinking,
// and context management. This is a deny list on purpose — an allow list of
// known-good version strings silently misses every future model, and falling
// back to the plain shape keeps a small max_tokens while the server still spends
// it on thinking. Unknown/newer Claude models therefore get the modern shape.
func anthropicModelSupportsModernFeatures(modelName string) bool {
	m := normalizeAnthropicModelID(modelName)
	// Non-Claude identifiers (empty, OpenAI-compatible gateway names) get the
	// plain shape: nothing guarantees they accept the Anthropic beta surface.
	if !strings.Contains(m, "claude") && !strings.Contains(m, "fable") && !strings.Contains(m, "mythos") {
		return false
	}
	for _, marker := range legacyAnthropicModelMarkers {
		if strings.Contains(m, marker) {
			return false
		}
	}
	return true
}

// anthropicOutputEffort maps the persisted effort setting onto the SDK constant.
// Effort is the depth knob on the modern request surface: budget_tokens was
// removed and 400s, so this is the only way to ask for more thinking. All five
// levels are accepted on current models.
func anthropicOutputEffort(effort string) anthropic.BetaOutputConfigEffort {
	switch model.NormalizeGeneralAIEffort(effort) {
	case model.GeneralAIEffortLow:
		return anthropic.BetaOutputConfigEffortLow
	case model.GeneralAIEffortMedium:
		return anthropic.BetaOutputConfigEffortMedium
	case model.GeneralAIEffortHigh:
		return anthropic.BetaOutputConfigEffortHigh
	case model.GeneralAIEffortMax:
		return anthropic.BetaOutputConfigEffortMax
	default:
		return anthropic.BetaOutputConfigEffortXhigh
	}
}

// anthropicSystemBlocks splits the system prompt into a cacheable prefix and the
// volatile remainder. The large, fixed systemPrompt renders identically on every
// request, so caching it lets multi-turn conversations read it at ~0.1x price;
// the per-request context (time, cluster, page) must stay outside that block or
// its timestamp would invalidate the cache on every single request.
func anthropicSystemBlocks(prompt string) []anthropic.BetaTextBlockParam {
	if !strings.HasPrefix(prompt, systemPrompt) {
		return []anthropic.BetaTextBlockParam{{Text: prompt}}
	}
	blocks := []anthropic.BetaTextBlockParam{{
		Text:         systemPrompt,
		CacheControl: anthropic.NewBetaCacheControlEphemeralParam(),
	}}
	if suffix := prompt[len(systemPrompt):]; strings.TrimSpace(suffix) != "" {
		blocks = append(blocks, anthropic.BetaTextBlockParam{Text: suffix})
	}
	return blocks
}

func (p *anthropicProvider) Stream(
	ctx context.Context,
	request providerRequest,
	sendEvent func(AgentEvent),
) (AgentMessage, error) {
	// max_tokens is sent as configured. It is a ceiling on thinking + answer
	// combined, but an unused ceiling costs nothing, so silently raising an
	// operator's explicit budget would only inflate their bill. Depth is asked
	// for with output effort below, not by inflating this number.
	params := anthropic.BetaMessageNewParams{
		Model:     request.Model,
		Messages:  toAnthropicMessages(request.Messages),
		System:    anthropicSystemBlocks(request.SystemPrompt),
		Tools:     AnthropicToolDefs(request.Tools),
		MaxTokens: int64(request.MaxTokens),
		ToolChoice: anthropic.BetaToolChoiceUnionParam{
			OfAuto: &anthropic.BetaToolChoiceAutoParam{},
		},
	}

	if anthropicModelSupportsModernFeatures(request.Model) {
		// Modern request surface — older models (e.g. claude-sonnet-4-5) 400 on
		// these, so apply them only when the model supports them.
		// display:"summarized" keeps the streamed thinking content populated;
		// the default "omitted" would blank out the UI's thinking bubble.
		params.Thinking = anthropic.BetaThinkingConfigParamUnion{OfAdaptive: &anthropic.BetaThinkingConfigAdaptiveParam{
			Display: anthropic.BetaThinkingConfigAdaptiveDisplaySummarized,
		}}
		params.OutputConfig = anthropic.BetaOutputConfigParam{Effort: anthropicOutputEffort(request.Effort)}
		// Context editing: the server clears the oldest tool results once the
		// transcript grows large, keeping long agent loops within budget without
		// summarizing. No-op on gateways that don't honor the beta.
		params.ContextManagement = anthropic.BetaContextManagementConfigParam{
			Edits: []anthropic.BetaContextManagementConfigEditUnionParam{
				{OfClearToolUses20250919: &anthropic.BetaClearToolUses20250919EditParam{}},
			},
		}
		params.Betas = []anthropic.AnthropicBeta{anthropic.AnthropicBetaContextManagement2025_06_27}
	}

	stream := p.client.Beta.Messages.NewStreaming(ctx, params)
	return consumeAnthropicStreamingResponse(stream, sendEvent)
}

func toAnthropicMessages(messages []AgentMessage) []anthropic.BetaMessageParam {
	params := make([]anthropic.BetaMessageParam, 0, len(messages))
	for _, message := range messages {
		blocks := make([]anthropic.BetaContentBlockParamUnion, 0, len(message.Content))
		for _, block := range message.Content {
			switch block.Type {
			case contentBlockText:
				blocks = append(blocks, anthropic.NewBetaTextBlock(block.Text))
			case contentBlockThinking:
				// An unsigned thinking block cannot be replayed: the server
				// verifies the signature and rejects the turn without it.
				if block.Signature != "" {
					blocks = append(blocks, anthropic.NewBetaThinkingBlock(block.Signature, block.Text))
				}
			case contentBlockRedactedThinking:
				blocks = append(blocks, anthropic.NewBetaRedactedThinkingBlock(block.Data))
			case contentBlockToolCall:
				blocks = append(blocks, anthropic.NewBetaToolUseBlock(block.ToolCallID, toolUseInput(block.Arguments), block.ToolName))
			case contentBlockToolResult:
				blocks = append(blocks, anthropic.NewBetaToolResultBlock(block.ToolCallID, block.Text, block.IsError))
			}
		}
		if len(blocks) == 0 {
			continue
		}
		// Anthropic requires strictly alternating user/assistant roles, and a
		// tool-result turn counts as a user turn, so consecutive same-role
		// messages have to coalesce into one instead of being sent as two.
		role := anthropic.BetaMessageParamRoleUser
		if message.Role == messageRoleAssistant {
			role = anthropic.BetaMessageParamRoleAssistant
		}
		if n := len(params); n > 0 && params[n-1].Role == role {
			params[n-1].Content = append(params[n-1].Content, blocks...)
			continue
		}
		params = append(params, anthropic.BetaMessageParam{Role: role, Content: blocks})
	}
	return params
}

// toolUseInput keeps a nil argument map from marshalling to JSON null, which the
// API rejects as tool_use input.
func toolUseInput(args map[string]interface{}) any {
	if args == nil {
		return map[string]interface{}{}
	}
	return args
}

// toolArgsJSON renders decoded tool-call arguments back to a JSON object string.
// The beta ToolUseBlock carries Input as a decoded `any` (the stable block hands
// back raw JSON), so the raw form has to be reconstructed here to populate
// RawArguments. Nil/empty/null all collapse to "{}", matching toolUseInput.
func toolArgsJSON(args any) string {
	raw, err := json.Marshal(args)
	if err != nil {
		return "{}"
	}
	if trimmed := strings.TrimSpace(string(raw)); trimmed != "" && trimmed != "null" {
		return trimmed
	}
	return "{}"
}

func consumeAnthropicStreamingResponse(
	stream interface {
		Next() bool
		Current() anthropic.BetaRawMessageStreamEventUnion
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

	var message anthropic.BetaMessage
	for stream.Next() {
		event := stream.Current()
		if err := message.Accumulate(event); err != nil {
			return AgentMessage{}, err
		}

		if startEvent, ok := event.AsAny().(anthropic.BetaRawContentBlockStartEvent); ok {
			if thinkingBlock, ok := startEvent.ContentBlock.AsAny().(anthropic.BetaThinkingBlock); ok && thinkingBlock.Thinking != "" {
				sendEvent(AgentEvent{Type: "message_delta", Data: MessageDeltaEvent{
					BlockType: contentBlockThinking,
					Content:   thinkingBlock.Thinking,
				}})
			}
		}

		if deltaEvent, ok := event.AsAny().(anthropic.BetaRawContentBlockDeltaEvent); ok {
			if textDelta, ok := deltaEvent.Delta.AsAny().(anthropic.BetaTextDelta); ok && textDelta.Text != "" {
				sendEvent(AgentEvent{Type: "message_delta", Data: MessageDeltaEvent{
					BlockType: contentBlockText,
					Content:   textDelta.Text,
				}})
			}
			if thinkingDelta, ok := deltaEvent.Delta.AsAny().(anthropic.BetaThinkingDelta); ok && thinkingDelta.Thinking != "" {
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

	klog.V(2).Infof("Anthropic usage: input=%d cache_read=%d cache_write=%d output=%d",
		message.Usage.InputTokens, message.Usage.CacheReadInputTokens,
		message.Usage.CacheCreationInputTokens, message.Usage.OutputTokens)

	blocks := make([]ContentBlock, 0, len(message.Content))
	for _, content := range message.Content {
		switch block := content.AsAny().(type) {
		case anthropic.BetaTextBlock:
			blocks = append(blocks, ContentBlock{Type: contentBlockText, Text: block.Text})
		case anthropic.BetaThinkingBlock:
			blocks = append(blocks, ContentBlock{
				Type:      contentBlockThinking,
				Text:      block.Thinking,
				Signature: block.Signature,
			})
		case anthropic.BetaRedactedThinkingBlock:
			blocks = append(blocks, ContentBlock{Type: contentBlockRedactedThinking, Data: block.Data})
		case anthropic.BetaToolUseBlock:
			rawArguments := toolArgsJSON(block.Input)
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
