package ai

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"k8s.io/klog/v2"
)

const systemPrompt = `You are Kite AI, an intelligent assistant for Kubernetes cluster management. You help users understand, monitor, and manage their Kubernetes clusters safely and accurately.

You have access to tools that let you interact with the user's Kubernetes cluster. Use them to:
- Get information about specific resources (pods, deployments, services, etc.)
- List resources across namespaces
- Read pod logs for debugging
- Run a one-off non-interactive command in a Pod container when structured tools and logs are insufficient
- Get cluster-wide status overviews
- Query Prometheus metrics for monitoring data (requires cluster-wide read access)
- Create, update, patch or delete resources
- Manage Helm releases: list them, inspect details/values/history, update values, roll back, or uninstall

Operating principles:
- Tool-calling discipline: ALWAYS invoke tools through the native tool-calling mechanism. NEVER write a tool call as text or XML in your message — do not output strings like "<invoke ...>", "<parameter ...>", or "[Tool: ...]". Any tool call written as plain text is NOT executed and is a bug. If you intend to use a tool, emit a real tool call.
- Evidence first: collect relevant cluster state before conclusions. Do not guess cluster state.
- Read before write: before any mutation operation (create/update/patch/delete), inspect current related resources unless the request is an explicit create with complete details.
- Verify after write: after a mutation, re-check the affected resource(s) and report whether the change actually took effect.
- Scope safety: prefer the smallest safe scope; avoid broad or destructive actions unless the user explicitly asks for them.
- Pod exec safety: prefer read-only diagnostic commands. Do not use exec when a structured resource or log tool can answer the question.

Kite RBAC semantics:
- The verbs in Kite only include get, update, delete, create, log, and exec.
- patch is covered by update in Kite RBAC. If update is allowed, patch operations are allowed.
- watch is covered by get in Kite RBAC. If get is allowed, watch-style read operations are allowed.
- Do not treat missing patch or watch entries in RBAC context as denial before verb normalization.
- First check the RBAC context, clarify the permission boundaries. If the resource to be checked exceeds the permission scope, first explain the permission restrictions and suggest the next step.

Context priority:
- Follow explicit user instructions first.
- If user intent does not specify scope, use current page context (resource/namespace) as default scope.
- If scope is still unclear, ask a concise clarification question before mutating resources.

Creation and mutation guardrails:
- For mutation operations (create/update/patch/delete), always include a brief text explanation of what you are about to do alongside the tool call so the user can confirm.
- For create operations, do not assume critical defaults. If missing, ask for required details such as namespace, image/tag, ports/exposure, storage, resource requests/limits, and required config/secrets.
- When you need the user to choose from a short list, use request_choice instead of asking for a typed reply.
- When you need a few structured values, especially for resource creation, use request_form instead of asking the user to type the answers free-form.
- Do not use request_choice or request_form for the final confirmation of a create/update/patch/delete/exec action. After collecting the required inputs, call the action tool directly. The system already provides the final confirmation step.
- Do not output secret values. If sensitive fields are involved, summarize safely.

Failure handling:
- On Forbidden errors, explain the permission boundary and provide a least-privilege next step.
- If a tool returns Forbidden, do not retry the same verb/resource/scope. Choose a permitted scope or ask for RBAC changes.
- After a Forbidden result, stop further tool attempts that would require the same or broader permission in the current turn. Ask for a narrower allowed scope or permission update.
- On NotFound errors, confirm namespace/kind/name and suggest nearby resources when possible.
- On validation or apply errors, explain the failing field and provide a minimal fix.

Response style:
- Be concise but thorough.
- When analyzing logs or resource status, provide actionable insights.
- When showing resource details, highlight important fields like status, events, and conditions.
- If you detect issues (CrashLoopBackOff, OOMKilled, pending pods, etc.), proactively suggest solutions.
- Use valid GitHub-Flavored Markdown. Put commands and code in fenced code blocks, and close the fence before starting headings, lists, or tables. Do not wrap Markdown structure in a code fence.
- Feel free to respond with emojis where appropriate.`

// PageContext provides context about which page the user is viewing.
type PageContext struct {
	Page         string `json:"page"`
	Namespace    string `json:"namespace"`
	ResourceName string `json:"resource_name"`
	ResourceKind string `json:"resource_kind"`
}

// Agent handles the AI conversation loop with tool calling.
type Agent struct {
	providerName string
	provider     modelProvider
	cs           *cluster.ClientSet
	model        string
	maxTokens    int
	effort       string
}

type runtimePromptContext struct {
	ClusterName  string
	AccountName  string
	RBACOverview string
}

// Conversation/message truncation limits. User content and tool results get
// separate budgets: a user message is human-typed and self-limiting, while a
// tool result is sized by the model and one bad call can produce megabytes.
// The Anthropic path targets the current Claude models (1M-token context
// window); the OpenAI path must stay safe for smaller context windows.
//
// maxTotalChars is the load-bearing bound. Per-message caps multiplied by the
// message count do not bound a request — 300 x 200000 is ~15M tokens, far past
// any context window — and the server-side clear_tool_uses backstop only runs on
// the modern Anthropic shape, so legacy models have none. The aggregate budget is
// sized for the smallest context window each provider is realistically pointed
// at (~200K tokens), which holds for a 1M-window model too.
const (
	maxOpenAIConversationMessages = 30
	maxOpenAIMessageChars         = 8000
	maxOpenAIToolResultChars      = 8000
	maxOpenAITotalChars           = 120000

	maxAnthropicConversationMessages = 300
	maxAnthropicMessageChars         = 200000
	maxAnthropicToolResultChars      = 30000
	maxAnthropicTotalChars           = 600000
)

// truncationNotice is appended to content that had to be cut, so neither the
// model nor the user silently reads a sentence that stops mid-word.
const truncationNotice = "\n\n[... truncated by Kite: content exceeded the per-message limit ...]"

// conversationLimits groups the truncation budgets for one provider so call
// sites read by name instead of by the position of four bare ints.
type conversationLimits struct {
	maxMessages        int
	maxChars           int
	maxToolResultChars int
	maxTotalChars      int
}

var (
	openAILimits = conversationLimits{
		maxMessages:        maxOpenAIConversationMessages,
		maxChars:           maxOpenAIMessageChars,
		maxToolResultChars: maxOpenAIToolResultChars,
		maxTotalChars:      maxOpenAITotalChars,
	}
	anthropicLimits = conversationLimits{
		maxMessages:        maxAnthropicConversationMessages,
		maxChars:           maxAnthropicMessageChars,
		maxToolResultChars: maxAnthropicToolResultChars,
		maxTotalChars:      maxAnthropicTotalChars,
	}
)

// limits returns the truncation budgets for the agent's configured provider.
func (a *Agent) limits() conversationLimits {
	if a.providerName == model.GeneralAIProviderAnthropic {
		return anthropicLimits
	}
	return openAILimits
}

// NewAgent creates a new AI agent for a conversation.
func NewAgent(cs *cluster.ClientSet, cfg *RuntimeConfig) (*Agent, error) {
	provider := model.DefaultGeneralAIProvider
	if cfg != nil {
		provider = normalizeProvider(cfg.Provider)
	}

	modelName := model.DefaultGeneralAIModelByProvider(provider)
	if cfg != nil && cfg.Model != "" {
		modelName = cfg.Model
	}

	maxTokens := model.DefaultGeneralAIMaxTokensByProvider(provider)
	if cfg != nil && cfg.MaxTokens > 0 {
		maxTokens = cfg.MaxTokens
	}

	effort := model.DefaultGeneralAIEffort
	if cfg != nil && cfg.Effort != "" {
		effort = model.NormalizeGeneralAIEffort(cfg.Effort)
	}

	agent := &Agent{
		providerName: provider,
		cs:           cs,
		model:        modelName,
		maxTokens:    maxTokens,
		effort:       effort,
	}

	switch provider {
	case model.GeneralAIProviderAnthropic:
		client, err := NewAnthropicClient(cfg)
		if err != nil {
			return nil, err
		}
		agent.provider = &anthropicProvider{client: client}
	default:
		client, err := NewOpenAIClient(cfg)
		if err != nil {
			return nil, err
		}
		agent.provider = &openAIProvider{client: client}
	}

	return agent, nil
}

// truncateRunes caps s at max runes (not bytes), so multi-byte UTF-8 content
// (e.g. Chinese tool output) is never split mid-rune into an invalid sequence.
func truncateRunes(s string, max int) string {
	if max <= 0 {
		return ""
	}
	// Byte length <= max guarantees rune count <= max — skip the rune scan.
	if len(s) <= max {
		return s
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}

// truncationNoticeRunes is the notice's own cost against a message budget.
var truncationNoticeRunes = utf8.RuneCountInString(truncationNotice)

// truncateWithNotice caps s at max runes and, when content was actually cut,
// appends truncationNotice so the model does not read a sentence that stops
// mid-word with no indication anything is missing. The notice is counted against
// max, so the result never exceeds the cap.
func truncateWithNotice(s string, max int, label string) string {
	if max <= 0 {
		return ""
	}
	// Byte length <= max guarantees rune count <= max, so the common (uncut)
	// case never materializes a []rune. Only content past the byte bound pays
	// the rune count, and that count is exact — unlike len(s) it does not
	// over-report multi-byte content that actually fits.
	if len(s) <= max {
		return s
	}
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	keep := max - truncationNoticeRunes
	if keep <= 0 {
		// The budget cannot fit the notice; fall back to a plain hard cut.
		return truncateRunes(s, max)
	}
	klog.V(2).Infof("AI conversation: truncated %s to %d runes (limit %d)", label, keep, max)
	return truncateRunes(s, keep) + truncationNotice
}

// trimToTotalBudget drops whole messages, oldest first, until the transcript
// fits maxTotalChars. Per-message caps bound one message; only this bounds the
// request, which is what the provider's context window actually limits. A cut
// that lands between an assistant tool_call and its tool_result would orphan
// the result; the caller strips leading tool messages afterwards, which removes
// exactly those orphans.
func trimToTotalBudget(messages []AgentMessage, maxTotalChars int) []AgentMessage {
	if maxTotalChars <= 0 {
		return messages
	}

	total := 0
	keepFrom := 0
	for i := len(messages) - 1; i >= 0; i-- {
		size := 0
		for _, block := range messages[i].Content {
			size += utf8.RuneCountInString(block.Text) + utf8.RuneCountInString(block.Data)
		}
		if total+size > maxTotalChars && i != len(messages)-1 {
			keepFrom = i + 1
			break
		}
		total += size
	}

	if keepFrom == 0 {
		return messages
	}
	klog.V(2).Infof("AI conversation: dropped %d oldest message(s) to fit the %d-rune transcript budget",
		keepFrom, maxTotalChars)
	return messages[keepFrom:]
}

// leakedToolCallPattern matches tool calls that a model previously emitted as
// text/XML instead of via the native tool-calling mechanism: full or partial
// <invoke>/<parameter> blocks (including the antml: namespace) and "[Tool: x]"
// summary markers.
var leakedToolCallPattern = regexp.MustCompile(
	`(?is)<(?:antml:)?invoke\b.*?</(?:antml:)?invoke>` +
		`|</?(?:antml:)?(?:invoke|parameter)\b[^>]*>` +
		`|\[Tool:[^\]]*\]`,
)

// stripLeakedToolCalls removes textual/XML tool-call leakage from assistant
// content: whole <invoke>...</invoke> blocks (with their parameter junk),
// stray invoke/parameter tags, and "[Tool: x]" markers. Surrounding prose is
// left intact.
func stripLeakedToolCalls(content string) string {
	// Two-tier guard, behaviour-identical to running the regex unconditionally.
	// Every alternative in the pattern needs a "<" or a "[", and beyond that the
	// literal "invoke", "parameter", or "[tool:". Assistant turns carry YAML,
	// code, and shell output where "<" alone is ubiquitous, so checking only for
	// it sent nearly every message through a backtracking scan of the whole
	// (up to maxAnthropicMessageChars) string. The fold is case-insensitive
	// because the pattern is, and it only runs for candidates.
	if !strings.ContainsAny(content, "<[") {
		return content
	}
	lower := strings.ToLower(content)
	if !strings.Contains(lower, "invoke") &&
		!strings.Contains(lower, "parameter") &&
		!strings.Contains(lower, "[tool:") {
		return content
	}
	return leakedToolCallPattern.ReplaceAllString(content, "")
}

func summarizeScope(items []string) string {
	if len(items) == 0 {
		return "-"
	}
	scope := strings.Join(items, ",")
	if strings.Contains(scope, "get") {
		scope += ",list,watch"
	}
	return scope
}

func buildRBACOverview(user model.User) string {
	roles := rbac.GetUserRoles(user)
	if len(roles) == 0 {
		return "no roles"
	}

	sort.Slice(roles, func(i, j int) bool {
		return roles[i].Name < roles[j].Name
	})

	summaries := make([]string, 0, len(roles))
	for _, role := range roles {
		summaries = append(summaries, fmt.Sprintf(
			"%s[clusters=%s;namespaces=%s;resources=%s;verbs=%s]",
			role.Name,
			summarizeScope(role.Clusters),
			summarizeScope(role.Namespaces),
			summarizeScope(role.Resources),
			summarizeScope(role.Verbs),
		))
	}
	return strings.Join(summaries, " | ")
}

func buildRuntimePromptContext(c *gin.Context, cs *cluster.ClientSet) runtimePromptContext {
	ctx := runtimePromptContext{}
	if cs != nil {
		ctx.ClusterName = cs.Name
	}
	if c == nil {
		return ctx
	}
	rawUser, ok := c.Get("user")
	if !ok {
		return ctx
	}
	user, ok := rawUser.(model.User)
	if !ok {
		return ctx
	}
	ctx.AccountName = user.Key()
	ctx.RBACOverview = buildRBACOverview(user)
	return ctx
}

// contextualPromptSuffix returns the per-request/per-session context appended
// after the stable system prompt: current time, runtime context, page context,
// and response-language guidance. It is kept separate from the systemPrompt
// constant so the Anthropic path can cache the stable prefix while sending this
// volatile remainder uncached — a timestamp inside the cached block would
// invalidate the prompt cache on every request.
func contextualPromptSuffix(pageCtx *PageContext, runtimeCtx runtimePromptContext, language string) string {
	var b strings.Builder

	// Current system time
	fmt.Fprintf(&b, "\n\nCurrent system time: %s", time.Now().Format("2006-01-02 15:04:05 MST"))

	if runtimeCtx.ClusterName != "" || runtimeCtx.AccountName != "" || runtimeCtx.RBACOverview != "" {
		b.WriteString("\n\nCurrent runtime context:")
		if runtimeCtx.ClusterName != "" {
			fmt.Fprintf(&b, "\n- Current cluster: %s", runtimeCtx.ClusterName)
		}
		if runtimeCtx.AccountName != "" {
			fmt.Fprintf(&b, "\n- Current account name: %s", runtimeCtx.AccountName)
		}
		if runtimeCtx.RBACOverview != "" {
			fmt.Fprintf(&b, "\n- RBAC overview: %s", runtimeCtx.RBACOverview)
		}
	}

	if pageCtx != nil {
		b.WriteString("\n\nCurrent page context:")
		if pageCtx.Page != "" {
			fmt.Fprintf(&b, "\n- User is viewing: %s", pageCtx.Page)
		}
		if pageCtx.ResourceKind != "" && pageCtx.ResourceName != "" {
			fmt.Fprintf(&b, "\n- Current resource: %s/%s", pageCtx.ResourceKind, pageCtx.ResourceName)
		}
		if pageCtx.Namespace != "" {
			fmt.Fprintf(&b, "\n- Current namespace: %s", pageCtx.Namespace)
		}

		// Add contextual suggestions
		switch pageCtx.Page {
		case "overview":
			b.WriteString("\n- Suggest analyzing overall cluster health, resource utilization, and potential issues.")
		case "pod-detail":
			b.WriteString("\n- Focus on this pod's status, logs, events, and health. Proactively check for issues.")
		case "deployment-detail":
			b.WriteString("\n- Focus on this deployment's rollout status, replica health, and recent changes.")
		case "node-detail":
			b.WriteString("\n- Focus on this node's status, resource pressure, and pods running on it.")
		}
	}

	if language == "zh" {
		b.WriteString("\n\nResponse language:\n- Prefer replying in the same language as the user's latest message.\n- If the user's latest message language is unclear, respond in Simplified Chinese unless the user explicitly asks for another language.")
	} else {
		b.WriteString("\n\nResponse language:\n- Prefer replying in the same language as the user's latest message.\n- If the user's latest message language is unclear, respond in English unless the user explicitly asks for another language.")
	}

	return b.String()
}

// buildContextualSystemPrompt augments the system prompt with runtime/page
// context. Used by the OpenAI path (single system message); the Anthropic path
// caches systemPrompt and sends contextualPromptSuffix as a separate block.
func buildContextualSystemPrompt(pageCtx *PageContext, runtimeCtx runtimePromptContext, language string) string {
	prompt := systemPrompt + contextualPromptSuffix(pageCtx, runtimeCtx, language)
	klog.V(4).Infof("system prompt %s", prompt)
	return prompt
}

const maxAgentIterations = 100

const (
	continuationConfirm = "confirm"
	continuationSubmit  = "submit"
	continuationDeny    = "deny"
)

// emptyResponseMessage explains an empty turn using the provider's own stop
// reason. The Anthropic values ("max_tokens", "model_context_window_exceeded",
// …) and the OpenAI finish reasons ("length", "content_filter") describe the
// same operator-actionable conditions, so both are mapped here rather than in
// each provider.
func emptyResponseMessage(stopReason string, maxTokens int) string {
	switch stopReason {
	case "max_tokens", "length":
		return fmt.Sprintf("The model hit the Max Tokens limit (%d) before producing an answer. "+
			"On current Claude models thinking and answer share this budget — raise Max Tokens, "+
			"or lower Reasoning Effort, in Settings.", maxTokens)
	case "model_context_window_exceeded":
		return "The conversation exceeded the model's context window. Start a new chat, " +
			"or narrow the tool queries so less output is carried forward."
	case "refusal", "content_filter":
		return "The model declined this request."
	case "pause_turn":
		return "The model paused mid-turn without producing content. Send the message again to resume."
	default:
		if stopReason != "" {
			return fmt.Sprintf("AI returned no content (stop_reason: %s)", stopReason)
		}
		return "AI returned no content"
	}
}

func (a *Agent) ProcessChat(c *gin.Context, req *ChatRequest, sendEvent func(AgentEvent)) {
	runtimeCtx := buildRuntimePromptContext(c, a.cs)
	language := normalizeLanguage(req.Language)
	if language == "" {
		language = "en"
	}
	systemPrompt := buildContextualSystemPrompt(req.PageContext, runtimeCtx, language)
	a.runConversation(c, systemPrompt, normalizeAgentMessages(req.Messages, a.limits()), 0, sendEvent)
}

func (a *Agent) ContinuePending(
	c *gin.Context,
	sessionID string,
	action string,
	values map[string]interface{},
	sendEvent func(AgentEvent),
) error {
	session, err := agentPendingSessions.load(sessionID)
	if err != nil {
		return err
	}

	user, ok := currentUserFromGin(c)
	if !ok || user.ID != session.UserID || a.cs.Name != session.ClusterName {
		return fmt.Errorf("pending action does not belong to the current user and cluster")
	}
	if a.providerName != session.Provider || a.model != session.Model {
		return fmt.Errorf("AI provider or model changed while the action was pending")
	}
	if session.NextToolIndex < 0 || session.NextToolIndex >= len(session.ToolCalls) {
		return fmt.Errorf("pending action is invalid")
	}

	toolCall := session.ToolCalls[session.NextToolIndex]
	var result ToolResult
	executeMutation := false
	switch {
	case action == continuationDeny:
		result = ToolResult{
			ToolCallID: toolCall.ID,
			ToolName:   toolCall.Name,
			Content:    "User denied the requested action",
			IsError:    true,
		}
	case InteractionTools[toolCall.Name]:
		if action != continuationSubmit {
			return fmt.Errorf("pending input requires submitted values")
		}
		request, err := parseInteractionRequest(toolCall.Name, toolCall.Arguments)
		if err != nil {
			return err
		}
		content, err := buildInteractionToolResult(request, values)
		if err != nil {
			return err
		}
		result = ToolResult{ToolCallID: toolCall.ID, ToolName: toolCall.Name, Content: content}
	case MutationTools[toolCall.Name]:
		if action != continuationConfirm {
			return fmt.Errorf("pending action requires confirmation")
		}
		executeMutation = true
	default:
		return fmt.Errorf("pending action is invalid")
	}

	if err := agentPendingSessions.claim(sessionID); err != nil {
		return err
	}
	if executeMutation {
		content, isError := ExecuteTool(c.Request.Context(), c, a.cs, toolCall.Name, toolCall.Arguments)
		result = ToolResult{
			ToolCallID: toolCall.ID,
			ToolName:   toolCall.Name,
			Content:    content,
			IsError:    isError,
		}
	}

	sendEvent(AgentEvent{Type: "tool_result", Data: ToolResultEvent{ToolResult: result}})
	session.ToolResults = append(session.ToolResults, toolResultBlock(result))
	session.NextToolIndex++

	messages, paused := a.processToolBatch(c, session, false, sendEvent)
	if !paused {
		a.runConversation(c, session.SystemPrompt, messages, session.Iteration, sendEvent)
	}
	return nil
}

func (a *Agent) runConversation(
	c *gin.Context,
	systemPrompt string,
	messages []AgentMessage,
	startIteration int,
	sendEvent func(AgentEvent),
) {
	tools := toolDefinitions(a.cs)
	for iteration := startIteration; iteration < maxAgentIterations; iteration++ {
		message, err := a.provider.Stream(c.Request.Context(), providerRequest{
			SystemPrompt: systemPrompt,
			Messages:     messages,
			Tools:        tools,
			Model:        a.model,
			MaxTokens:    a.maxTokens,
			Effort:       a.effort,
		}, sendEvent)
		if err != nil {
			klog.Errorf("AI generation error: %v", err)
			sendEvent(AgentEvent{Type: "error", Data: ErrorEvent{Message: fmt.Sprintf("AI error: %v", err)}})
			return
		}
		if !message.hasContent() {
			// Explain the empty turn with the provider's own stop_reason. A bare
			// "AI returned no content" hides the two causes an operator can act
			// on — an exhausted output budget and an exceeded context window —
			// behind a message that reads like a Kite bug.
			sendEvent(AgentEvent{Type: "error", Data: ErrorEvent{
				Message: emptyResponseMessage(message.StopReason, a.maxTokens),
			}})
			return
		}

		messages = append(messages, message)
		sendEvent(AgentEvent{Type: "message_end", Data: MessageEndEvent{Message: message}})
		toolCalls := message.toolCalls()
		if len(toolCalls) == 0 {
			return
		}

		for _, toolCall := range toolCalls {
			sendEvent(AgentEvent{Type: "tool_call", Data: ToolCallEvent{ToolCall: toolCall}})
		}

		var paused bool
		messages, paused = a.processToolBatch(c, pendingSession{
			Provider:      a.providerName,
			Model:         a.model,
			SystemPrompt:  systemPrompt,
			Messages:      messages,
			ToolCalls:     toolCalls,
			NextToolIndex: 0,
			Iteration:     iteration + 1,
		}, true, sendEvent)
		if paused {
			return
		}
	}

	sendEvent(AgentEvent{Type: "error", Data: ErrorEvent{Message: "Too many tool calling iterations"}})
}

func (a *Agent) processToolBatch(
	c *gin.Context,
	session pendingSession,
	bindSession bool,
	sendEvent func(AgentEvent),
) ([]AgentMessage, bool) {
	if bindSession {
		user, _ := currentUserFromGin(c)
		session.UserID = user.ID
		session.ClusterName = a.cs.Name
	}

	for session.NextToolIndex < len(session.ToolCalls) {
		toolCall := session.ToolCalls[session.NextToolIndex]
		if toolCall.ArgumentError != "" {
			result := ToolResult{
				ToolCallID: toolCall.ID,
				ToolName:   toolCall.Name,
				Content:    "Failed to parse arguments: " + toolCall.ArgumentError,
				IsError:    true,
			}
			sendEvent(AgentEvent{Type: "tool_result", Data: ToolResultEvent{ToolResult: result}})
			session.ToolResults = append(session.ToolResults, toolResultBlock(result))
			session.NextToolIndex++
			continue
		}

		if InteractionTools[toolCall.Name] {
			request, err := parseInteractionRequest(toolCall.Name, toolCall.Arguments)
			if err != nil {
				result := ToolResult{
					ToolCallID: toolCall.ID,
					ToolName:   toolCall.Name,
					Content:    "Error: " + err.Error(),
					IsError:    true,
				}
				sendEvent(AgentEvent{Type: "tool_result", Data: ToolResultEvent{ToolResult: result}})
				session.ToolResults = append(session.ToolResults, toolResultBlock(result))
				session.NextToolIndex++
				continue
			}

			sessionID, err := agentPendingSessions.save(session)
			if err != nil {
				sendEvent(AgentEvent{Type: "error", Data: ErrorEvent{Message: "Failed to save pending session"}})
				return session.Messages, true
			}
			sendEvent(AgentEvent{Type: "input_required", Data: InputRequiredEvent{
				SessionID: sessionID,
				ToolCall:  toolCall,
				Input:     request,
			}})
			return session.Messages, true
		}

		if MutationTools[toolCall.Name] {
			content, isError := AuthorizeTool(c, a.cs, toolCall.Name, toolCall.Arguments)
			if isError {
				result := ToolResult{
					ToolCallID: toolCall.ID,
					ToolName:   toolCall.Name,
					Content:    content,
					IsError:    true,
				}
				sendEvent(AgentEvent{Type: "tool_result", Data: ToolResultEvent{ToolResult: result}})
				session.ToolResults = append(session.ToolResults, toolResultBlock(result))
				session.NextToolIndex++
				continue
			}

			sessionID, err := agentPendingSessions.save(session)
			if err != nil {
				sendEvent(AgentEvent{Type: "error", Data: ErrorEvent{Message: "Failed to save pending session"}})
				return session.Messages, true
			}
			sendEvent(AgentEvent{Type: "confirmation_required", Data: ConfirmationRequiredEvent{
				SessionID: sessionID,
				ToolCall:  toolCall,
			}})
			return session.Messages, true
		}

		content, isError := ExecuteTool(c.Request.Context(), c, a.cs, toolCall.Name, toolCall.Arguments)
		// Cap the live result the same way replayed history is capped. The
		// per-tool bounds (log bytes, item counts) do not cover every tool —
		// get_resource yaml-marshals whole objects — so without this an
		// oversized result is only trimmed on the *next* turn, after the
		// oversized request has already been sent.
		content = truncateWithNotice(content, a.limits().maxToolResultChars, "tool result "+toolCall.Name)
		result := ToolResult{
			ToolCallID: toolCall.ID,
			ToolName:   toolCall.Name,
			Content:    content,
			IsError:    isError,
		}
		sendEvent(AgentEvent{Type: "tool_result", Data: ToolResultEvent{ToolResult: result}})
		session.ToolResults = append(session.ToolResults, toolResultBlock(result))
		session.NextToolIndex++
	}

	if len(session.ToolResults) > 0 {
		session.Messages = append(session.Messages, AgentMessage{
			Role:    messageRoleTool,
			Content: session.ToolResults,
		})
	}
	return session.Messages, false
}
