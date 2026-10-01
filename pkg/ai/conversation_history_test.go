package ai

import (
	"strings"
	"testing"
	"unicode/utf8"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/zxh326/kite/pkg/model"
)

// TestToAnthropicMessagesRebuildsToolRoundTrip verifies the core fix: a tool
// turn in the history is rebuilt into structured tool_use + tool_result blocks
// (not flattened to text), roles stay alternating, and any tool-call text a
// previous broken turn leaked into assistant content is stripped.
func TestToAnthropicMessagesRebuildsToolRoundTrip(t *testing.T) {
	history := []AgentMessage{
		{Role: messageRoleUser, Content: []ContentBlock{{Type: contentBlockText, Text: "find pod nginx"}}},
		{Role: messageRoleAssistant, Content: []ContentBlock{{Type: contentBlockText, Text: "Let me check."}}},
		{Role: messageRoleAssistant, Content: []ContentBlock{{
			Type:       contentBlockToolCall,
			ToolCallID: "toolu_1",
			ToolName:   "get_resource",
			Arguments:  map[string]interface{}{"kind": "Pod", "name": "nginx"},
		}}},
		{Role: messageRoleTool, Content: []ContentBlock{{
			Type:       contentBlockToolResult,
			ToolCallID: "toolu_1",
			ToolName:   "get_resource",
			Text:       "status: Running",
		}}},
		{Role: messageRoleAssistant, Content: []ContentBlock{{
			Type: contentBlockText,
			Text: "It is running. [Tool: get_resource] <invoke name=\"get_resource\"><parameter name=\"kind\">Pod</parameter></invoke>",
		}}},
		{Role: messageRoleUser, Content: []ContentBlock{{Type: contentBlockText, Text: "is it healthy?"}}},
	}

	msgs := toAnthropicMessages(normalizeAgentMessages(history, anthropicLimits))

	var sawToolUse, sawToolResult bool
	for _, m := range msgs {
		for _, b := range m.Content {
			if b.OfToolUse != nil {
				sawToolUse = true
				if b.OfToolUse.ID != "toolu_1" || b.OfToolUse.Name != "get_resource" {
					t.Fatalf("unexpected tool_use: id=%q name=%q", b.OfToolUse.ID, b.OfToolUse.Name)
				}
			}
			if b.OfToolResult != nil {
				sawToolResult = true
				if b.OfToolResult.ToolUseID != "toolu_1" {
					t.Fatalf("tool_result tool_use_id mismatch: %q", b.OfToolResult.ToolUseID)
				}
			}
			if b.OfText != nil {
				if strings.Contains(b.OfText.Text, "<invoke") || strings.Contains(b.OfText.Text, "[Tool:") {
					t.Fatalf("leaked tool-call text survived sanitization: %q", b.OfText.Text)
				}
			}
		}
	}
	if !sawToolUse {
		t.Fatal("expected a structured tool_use block in the rebuilt history")
	}
	if !sawToolResult {
		t.Fatal("expected a structured tool_result block in the rebuilt history")
	}

	// Roles must strictly alternate (Anthropic rejects consecutive same-role).
	for i := 1; i < len(msgs); i++ {
		if msgs[i].Role == msgs[i-1].Role {
			t.Fatalf("consecutive same-role messages at index %d: %s", i, msgs[i].Role)
		}
	}

	// First message must be a user turn.
	if len(msgs) == 0 || string(msgs[0].Role) != "user" {
		t.Fatalf("first message must be user, got %#v", msgs)
	}

	// The assistant text + following tool_use must coalesce into one message.
	var assistantWithText int
	for _, m := range msgs {
		if string(m.Role) != "assistant" {
			continue
		}
		hasText, hasTool := false, false
		for _, b := range m.Content {
			if b.OfText != nil {
				hasText = true
			}
			if b.OfToolUse != nil {
				hasTool = true
			}
		}
		if hasText && hasTool {
			assistantWithText++
		}
	}
	if assistantWithText == 0 {
		t.Fatal("expected assistant text to coalesce with the following tool_use into one message")
	}
}

func TestNormalizeAgentMessagesDropsLeadingToolTurn(t *testing.T) {
	// A history that (after truncation) would start with an orphaned tool turn
	// must be trimmed so the first provider message is a user turn — a leading
	// tool_result with no preceding tool_use is an invalid request.
	history := []AgentMessage{
		{Role: messageRoleTool, Content: []ContentBlock{{
			Type:       contentBlockToolResult,
			ToolCallID: "toolu_x",
			ToolName:   "get_resource",
			Text:       "ok",
		}}},
		{Role: messageRoleUser, Content: []ContentBlock{{Type: contentBlockText, Text: "hello"}}},
	}

	normalized := normalizeAgentMessages(history, anthropicLimits)
	if len(normalized) == 0 || normalized[0].Role != messageRoleUser {
		t.Fatalf("expected the leading tool turn dropped, got %#v", normalized)
	}

	msgs := toAnthropicMessages(normalized)
	if len(msgs) == 0 || string(msgs[0].Role) != "user" {
		t.Fatalf("expected first message to be user, got %#v", msgs)
	}
}

func TestTruncateRunesDoesNotSplitMultibyte(t *testing.T) {
	// 5 Chinese runes = 15 bytes. Truncating to 3 runes must yield exactly the
	// first 3 runes (valid UTF-8) — a byte-slice would have split a rune.
	out := truncateRunes("你好世界啊", 3)
	if out != "你好世" {
		t.Fatalf("expected first 3 runes, got %q", out)
	}
	if !utf8.ValidString(out) {
		t.Fatalf("truncation produced invalid UTF-8: %q", out)
	}
	if got := truncateRunes("abc", 10); got != "abc" {
		t.Fatalf("expected unchanged, got %q", got)
	}
	if got := truncateRunes("abc", 0); got != "" {
		t.Fatalf("expected empty for max<=0, got %q", got)
	}
}

func TestAnthropicModelSupportsModernFeatures(t *testing.T) {
	modern := []string{
		"claude-opus-5", "claude-sonnet-5", "claude-fable-5", "claude-mythos-5",
		"claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6",
		// A future model unknown to this build must not silently regress to the
		// plain shape: on Opus 5 and later, thinking runs even when the parameter
		// is omitted, so the plain shape spends max_tokens on thinking.
		"claude-opus-6", "claude-sonnet-7",
		// Provider-prefixed and case-variant identifiers still resolve.
		"anthropic.claude-opus-5", "Claude-Opus-5",
	}
	for _, m := range modern {
		if !anthropicModelSupportsModernFeatures(m) {
			t.Fatalf("expected %q to support modern features", m)
		}
	}
	// Legacy models 400 on effort / adaptive thinking / context management, and
	// non-Claude identifiers carry no such guarantee — both take the plain shape.
	legacy := []string{
		"claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-5", "claude-opus-4-1",
		"claude-3-7-sonnet-20250219", "claude-3-opus-20240229", "claude-2.1",
		"gpt-4o-mini", "",
		// Separator variants of the same legacy models. Gateways and Vertex spell
		// versions with '.', '@', ':' and '/', so the deny list must match the
		// normalized form or these fail open and 400 on the beta params.
		"anthropic/claude-3.5-sonnet", "claude-3.5-haiku",
		"claude-sonnet-4@20250514", "claude-opus-4@20250514",
		"anthropic.claude-3-5-sonnet-20241022-v2:0",
		"anthropic.claude-v2:1", "anthropic.claude-instant-v1",
		// Dated snapshots of the 4-series.
		"claude-sonnet-4-20250514", "claude-opus-4-20250514",
	}
	for _, m := range legacy {
		if anthropicModelSupportsModernFeatures(m) {
			t.Fatalf("expected %q NOT to support modern features", m)
		}
	}
}

func TestNormalizeAgentMessagesUsesSeparateToolResultBudget(t *testing.T) {
	// A user message and a tool result of the same size must be cut against
	// their own budgets: user content is human-authored and gets the generous
	// cap, tool results are model-sized and get the tight one.
	const userCap, toolCap = 5000, 500
	body := strings.Repeat("x", 2000)
	msgs := []AgentMessage{
		{Role: messageRoleUser, Content: []ContentBlock{{Type: contentBlockText, Text: body}}},
		{Role: messageRoleTool, Content: []ContentBlock{{
			Type:       contentBlockToolResult,
			ToolCallID: "t1",
			ToolName:   "get_pod_logs",
			Text:       body,
		}}},
		{Role: messageRoleUser, Content: []ContentBlock{{Type: contentBlockText, Text: "follow-up"}}},
	}

	out := normalizeAgentMessages(msgs, conversationLimits{
		maxMessages:        100,
		maxChars:           userCap,
		maxToolResultChars: toolCap,
		maxTotalChars:      maxAnthropicTotalChars,
	})

	var sawUser, sawTool bool
	for _, m := range out {
		for _, b := range m.Content {
			switch b.Type {
			case contentBlockText:
				if b.Text == body {
					sawUser = true // fits under userCap → untouched
				}
			case contentBlockToolResult:
				sawTool = true
				if n := len([]rune(b.Text)); n > toolCap {
					t.Fatalf("tool result must respect its own cap %d, got %d", toolCap, n)
				}
				if !strings.HasSuffix(b.Text, truncationNotice) {
					t.Fatalf("truncated tool result must carry the notice")
				}
			}
		}
	}
	if !sawUser {
		t.Fatal("user message within its budget must pass through unmodified")
	}
	if !sawTool {
		t.Fatal("tool round-trip was dropped")
	}
}

func TestTruncateWithNoticeMarksCutContent(t *testing.T) {
	long := strings.Repeat("x", 500)
	out := truncateWithNotice(long, 100, "test content")
	if len([]rune(out)) > 100 {
		t.Fatalf("result must stay within the cap, got %d runes", len([]rune(out)))
	}
	if !strings.HasSuffix(out, truncationNotice) {
		t.Fatalf("truncated content must carry the notice, got %q", out)
	}
	// Content that fits is returned byte-identical, with no notice appended.
	if got := truncateWithNotice("short", 100, "test content"); got != "short" {
		t.Fatalf("expected unchanged content, got %q", got)
	}
	// Multi-byte content whose BYTE length exceeds the cap but whose RUNE count
	// does not must pass through untouched — len(s) alone would over-report it.
	fits := strings.Repeat("中", 50)
	if got := truncateWithNotice(fits, 100, "test content"); got != fits {
		t.Fatalf("multi-byte content within the rune cap must be unchanged, got %d runes", len([]rune(got)))
	}
	// Appending the notice must not split the kept prefix mid-rune.
	cn := strings.Repeat("中", 200)
	cnOut := truncateWithNotice(cn, 120, "test content")
	if !utf8.ValidString(cnOut) {
		t.Fatalf("truncation produced invalid UTF-8")
	}
	if got := truncateWithNotice("abc", 0, "test content"); got != "" {
		t.Fatalf("expected empty for max<=0, got %q", got)
	}
}

func TestTrimToTotalBudgetDropsOldestMessages(t *testing.T) {
	// Per-message caps cannot bound a request; the aggregate budget is what the
	// provider's context window actually limits.
	body := strings.Repeat("x", 1000)
	msgs := []AgentMessage{
		{Role: messageRoleUser, Content: []ContentBlock{{Type: contentBlockText, Text: body}}},
		{Role: messageRoleAssistant, Content: []ContentBlock{{Type: contentBlockText, Text: body}}},
		{Role: messageRoleUser, Content: []ContentBlock{{Type: contentBlockText, Text: body}}},
	}

	out := trimToTotalBudget(msgs, 2500)
	if len(out) != 2 {
		t.Fatalf("expected the oldest message dropped, got %d messages", len(out))
	}
	total := 0
	for _, m := range out {
		for _, b := range m.Content {
			total += len([]rune(b.Text))
		}
	}
	if total > 2500 {
		t.Fatalf("transcript must fit the budget, got %d runes", total)
	}

	// A transcript already within budget is returned untouched.
	if got := trimToTotalBudget(msgs, 100000); len(got) != len(msgs) {
		t.Fatalf("expected all %d messages kept, got %d", len(msgs), len(got))
	}

	// The newest turn is never dropped, even when it alone exceeds the budget —
	// dropping it would send a request with no current question.
	if got := trimToTotalBudget(msgs, 10); len(got) != 1 {
		t.Fatalf("expected the newest message retained, got %d", len(got))
	}

	// Tool results count against the budget, not just assistant/user text.
	toolMsgs := []AgentMessage{
		{Role: messageRoleTool, Content: []ContentBlock{{
			Type: contentBlockToolResult, ToolCallID: "t1", ToolName: "x", Text: body,
		}}},
		{Role: messageRoleTool, Content: []ContentBlock{{
			Type: contentBlockToolResult, ToolCallID: "t2", ToolName: "x", Text: body,
		}}},
		{Role: messageRoleUser, Content: []ContentBlock{{Type: contentBlockText, Text: "now"}}},
	}
	if got := trimToTotalBudget(toolMsgs, 1500); len(got) != 2 {
		t.Fatalf("tool results must count toward the budget, got %d messages", len(got))
	}
}

func TestStripLeakedToolCalls(t *testing.T) {
	in := "before [Tool: get_resource] <invoke name=\"x\"><parameter name=\"a\">1</parameter></invoke> after"
	out := stripLeakedToolCalls(in)
	if strings.Contains(out, "<invoke") || strings.Contains(out, "parameter") || strings.Contains(out, "[Tool:") {
		t.Fatalf("leak not stripped: %q", out)
	}
	if !strings.Contains(out, "before") || !strings.Contains(out, "after") {
		t.Fatalf("normal prose should be preserved: %q", out)
	}

	// Plain prose without leakage must be returned untouched.
	clean := "the pod is running normally"
	if stripLeakedToolCalls(clean) != clean {
		t.Fatalf("clean prose was modified: %q", stripLeakedToolCalls(clean))
	}
}

func TestAnthropicSystemBlocksCachesStablePrefix(t *testing.T) {
	// The fixed prompt must ride in its own cache_control block and the volatile
	// per-request context in a separate uncached one — a timestamp inside the
	// cached block would invalidate the prefix on every single request.
	suffix := "\n\nCurrent system time: 2026-08-17 10:00:00 UTC"
	blocks := anthropicSystemBlocks(systemPrompt + suffix)
	if len(blocks) != 2 {
		t.Fatalf("expected a cached prefix and an uncached suffix, got %d block(s)", len(blocks))
	}
	if blocks[0].Text != systemPrompt {
		t.Fatal("the cached block must hold exactly the stable system prompt")
	}
	if blocks[0].CacheControl.Type == "" {
		t.Fatal("the stable prefix must carry cache_control")
	}
	if blocks[1].Text != suffix {
		t.Fatalf("the uncached block must hold the volatile suffix, got %q", blocks[1].Text)
	}
	if blocks[1].CacheControl.Type != "" {
		t.Fatal("the volatile suffix must not be cached")
	}

	// A prompt that does not start with the stable prefix (a caller that built
	// it differently) still has to produce a valid single-block system.
	single := anthropicSystemBlocks("custom prompt")
	if len(single) != 1 || single[0].Text != "custom prompt" {
		t.Fatalf("unexpected fallback blocks: %#v", single)
	}
}

func TestAnthropicOutputEffortMapsEveryLevel(t *testing.T) {
	// Every persisted level must reach the SDK. A level that silently collapsed
	// to a weaker one would cap reasoning depth with no way for the operator to
	// tell, since effort is the only depth knob on the modern request surface.
	cases := map[string]anthropic.BetaOutputConfigEffort{
		model.GeneralAIEffortLow:    anthropic.BetaOutputConfigEffortLow,
		model.GeneralAIEffortMedium: anthropic.BetaOutputConfigEffortMedium,
		model.GeneralAIEffortHigh:   anthropic.BetaOutputConfigEffortHigh,
		model.GeneralAIEffortXHigh:  anthropic.BetaOutputConfigEffortXhigh,
		model.GeneralAIEffortMax:    anthropic.BetaOutputConfigEffortMax,
	}
	for level, want := range cases {
		if got := anthropicOutputEffort(level); got != want {
			t.Fatalf("effort %q mapped to %q, want %q", level, got, want)
		}
	}

	// An empty or unknown value falls back to the default rather than to the
	// SDK zero value, which would omit effort from the request entirely.
	for _, unknown := range []string{"", "   ", "extreme"} {
		if got := anthropicOutputEffort(unknown); got != anthropic.BetaOutputConfigEffortXhigh {
			t.Fatalf("unknown effort %q mapped to %q, want the xhigh default", unknown, got)
		}
	}

	// Case and padding are normalized, so a hand-edited DB row still resolves.
	if got := anthropicOutputEffort("  MAX "); got != anthropic.BetaOutputConfigEffortMax {
		t.Fatalf("padded/uppercase effort mapped to %q, want max", got)
	}
}
