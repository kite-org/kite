package ai

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/gin-gonic/gin"
	"github.com/openai/openai-go"
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
- Get cluster-wide status overviews
- Query Prometheus metrics for monitoring data (requires cluster-wide read access)
- Create, update, patch or delete resources

Operating principles:
- Evidence first: collect relevant cluster state before conclusions. Do not guess cluster state.
- Read before write: before any mutation operation (create/update/patch/delete), inspect current related resources unless the request is an explicit create with complete details.
- Verify after write: after a mutation, re-check the affected resource(s) and report whether the change actually took effect.
- Scope safety: prefer the smallest safe scope; avoid broad or destructive actions unless the user explicitly asks for them.

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
- Do not use request_choice or request_form for the final yes/no confirmation of a create/update/patch/delete. After collecting the required inputs, call the mutation tool directly. The system already provides the final confirmation step for mutation tools.
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
- Feel free to respond with emojis where appropriate.`

// ChatMessage represents a message in the conversation.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// PageContext provides context about which page the user is viewing.
type PageContext struct {
	Page         string `json:"page"`
	Namespace    string `json:"namespace"`
	ResourceName string `json:"resource_name"`
	ResourceKind string `json:"resource_kind"`
}

// ChatRequest is the incoming chat request.
type ChatRequest struct {
	Messages    []ChatMessage `json:"messages"`
	Language    string        `json:"language,omitempty"`
	PageContext *PageContext  `json:"page_context"`
}

// SSEEvent represents a Server-Sent Event to the client.
type SSEEvent struct {
	Event string      `json:"event"`
	Data  interface{} `json:"data"`
}

// Agent handles the AI conversation loop with tool calling.
type Agent struct {
	provider        string
	openaiClient    openai.Client
	anthropicClient anthropic.Client
	cs              *cluster.ClientSet
	model           string
	maxTokens       int
}

type runtimePromptContext struct {
	ClusterName  string
	AccountName  string
	RBACOverview string
}

const maxConversationMessages = 30
const maxMessageChars = 8000

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

	maxTokens := 4096
	if cfg != nil && cfg.MaxTokens > 0 {
		maxTokens = cfg.MaxTokens
	}

	agent := &Agent{
		provider:  provider,
		cs:        cs,
		model:     modelName,
		maxTokens: maxTokens,
	}

	switch provider {
	case model.GeneralAIProviderAnthropic:
		client, err := NewAnthropicClient(cfg)
		if err != nil {
			return nil, err
		}
		agent.anthropicClient = client
	default:
		client, err := NewOpenAIClient(cfg)
		if err != nil {
			return nil, err
		}
		agent.openaiClient = client
	}

	return agent, nil
}
func normalizeChatMessages(chatMessages []ChatMessage) []ChatMessage {
	if len(chatMessages) > maxConversationMessages {
		chatMessages = chatMessages[len(chatMessages)-maxConversationMessages:]
	}

	normalized := make([]ChatMessage, 0, len(chatMessages))
	for _, msg := range chatMessages {
		content := strings.TrimSpace(msg.Content)
		if content == "" {
			continue
		}
		if len(content) > maxMessageChars {
			content = content[:maxMessageChars]
		}

		role := "user"
		if msg.Role == "assistant" {
			role = "assistant"
		}

		normalized = append(normalized, ChatMessage{
			Role:    role,
			Content: content,
		})
	}
	return normalized
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

// buildContextualSystemPrompt augments the system prompt with runtime/page context.
func buildContextualSystemPrompt(pageCtx *PageContext, runtimeCtx runtimePromptContext, language string) string {
	prompt := systemPrompt

	// Add current system time
	prompt += fmt.Sprintf("\n\nCurrent system time: %s", time.Now().Format("2006-01-02 15:04:05 MST"))

	if runtimeCtx.ClusterName != "" || runtimeCtx.AccountName != "" || runtimeCtx.RBACOverview != "" {
		prompt += "\n\nCurrent runtime context:"
		if runtimeCtx.ClusterName != "" {
			prompt += fmt.Sprintf("\n- Current cluster: %s", runtimeCtx.ClusterName)
		}
		if runtimeCtx.AccountName != "" {
			prompt += fmt.Sprintf("\n- Current account name: %s", runtimeCtx.AccountName)
		}
		if runtimeCtx.RBACOverview != "" {
			prompt += fmt.Sprintf("\n- RBAC overview: %s", runtimeCtx.RBACOverview)
		}
	}

	if pageCtx != nil {
		prompt += "\n\nCurrent page context:"
		if pageCtx.Page != "" {
			prompt += fmt.Sprintf("\n- User is viewing: %s", pageCtx.Page)
		}
		if pageCtx.ResourceKind != "" && pageCtx.ResourceName != "" {
			prompt += fmt.Sprintf("\n- Current resource: %s/%s", pageCtx.ResourceKind, pageCtx.ResourceName)
		}
		if pageCtx.Namespace != "" {
			prompt += fmt.Sprintf("\n- Current namespace: %s", pageCtx.Namespace)
		}

		// Add contextual suggestions
		switch pageCtx.Page {
		case "overview":
			prompt += "\n- Suggest analyzing overall cluster health, resource utilization, and potential issues."
		case "pod-detail":
			prompt += "\n- Focus on this pod's status, logs, events, and health. Proactively check for issues."
		case "deployment-detail":
			prompt += "\n- Focus on this deployment's rollout status, replica health, and recent changes."
		case "node-detail":
			prompt += "\n- Focus on this node's status, resource pressure, and pods running on it."
		}
	}

	if language == "zh" {
		prompt += "\n\nResponse language:\n- Prefer replying in the same language as the user's latest message.\n- If the user's latest message language is unclear, respond in Simplified Chinese unless the user explicitly asks for another language."
	} else {
		prompt += "\n\nResponse language:\n- Prefer replying in the same language as the user's latest message.\n- If the user's latest message language is unclear, respond in English unless the user explicitly asks for another language."
	}

	klog.V(4).Infof("system prompt %s", prompt)
	return prompt
}

// ProcessChat runs the AI conversation loop and sends SSE events via the callback.
func (a *Agent) ProcessChat(c *gin.Context, req *ChatRequest, sendEvent func(SSEEvent)) {
	switch a.provider {
	case model.GeneralAIProviderAnthropic:
		a.processChatAnthropic(c, req, sendEvent)
	default:
		a.processChatOpenAI(c, req, sendEvent)
	}
}

func (a *Agent) ContinuePendingAction(c *gin.Context, sessionID string, sendEvent func(SSEEvent)) error {
	session, err := agentPendingSessions.take(sessionID)
	if err != nil {
		return err
	}

	switch session.Provider {
	case model.GeneralAIProviderAnthropic:
		return a.continueChatAnthropic(c, session, sendEvent)
	default:
		return a.continueChatOpenAI(c, session, sendEvent)
	}
}

func (a *Agent) ContinuePendingInput(c *gin.Context, sessionID string, values map[string]interface{}, sendEvent func(SSEEvent)) error {
	session, err := agentPendingSessions.load(sessionID)
	if err != nil {
		return err
	}
	if !InteractionTools[session.ToolCall.Name] {
		return fmt.Errorf("pending input not found or expired")
	}

	request, err := parseInteractionRequest(session.ToolCall.Name, session.ToolCall.Args)
	if err != nil {
		return err
	}
	result, err := buildInteractionToolResult(request, values)
	if err != nil {
		return err
	}

	agentPendingSessions.delete(sessionID)

	switch session.Provider {
	case model.GeneralAIProviderAnthropic:
		return a.continueChatAnthropicWithToolResult(c, session, result, false, sendEvent)
	default:
		return a.continueChatOpenAIWithToolResult(c, session, result, false, sendEvent)
	}
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

type streamedToolCall struct {
	Index     int64
	ID        string
	Name      string
	Arguments string
}

// MarshalSSEEvent marshals an SSE event to JSON for sending.
func MarshalSSEEvent(event SSEEvent) string {
	data, err := json.Marshal(event.Data)
	if err != nil {
		return "event: error\ndata: {\"message\":\"marshal error\"}\n\n"
	}
	return fmt.Sprintf("event: %s\ndata: %s\n\n", event.Event, string(data))
}
