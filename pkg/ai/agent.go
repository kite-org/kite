package ai

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

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
	client openai.Client
	cs     *cluster.ClientSet
	model  string
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
	llm, err := NewLLMClient(cfg)
	if err != nil {
		return nil, err
	}
	modelName := model.DefaultGeneralAIModel
	if cfg != nil && cfg.Model != "" {
		modelName = cfg.Model
	}

	return &Agent{
		client: llm,
		cs:     cs,
		model:  modelName,
	}, nil
}

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
		prompt += "\n\nResponse language:\n- Always respond in Simplified Chinese unless the user explicitly asks for another language."
	} else {
		prompt += "\n\nResponse language:\n- Always respond in English unless the user explicitly asks for another language."
	}

	klog.V(4).Infof("system prompt %s", prompt)
	return prompt
}

// ProcessChat runs the AI conversation loop and sends SSE events via the callback.
func (a *Agent) ProcessChat(c *gin.Context, req *ChatRequest, sendEvent func(SSEEvent)) {
	ctx := c.Request.Context()
	runtimeCtx := buildRuntimePromptContext(c, a.cs)
	language := normalizeLanguage(req.Language)
	if language == "" {
		language = "en"
	}
	sysPrompt := buildContextualSystemPrompt(req.PageContext, runtimeCtx, language)
	messages := toOpenAIMessages(sysPrompt, req.Messages)

	tools := ToolDefs()

	// Tool calling loop - iterate until we get a text response (no more tool calls)
	maxIterations := 10
	for i := 0; i < maxIterations; i++ {
		stream := a.client.Chat.Completions.NewStreaming(ctx, openai.ChatCompletionNewParams{
			Model:    a.model,
			Messages: messages,
			Tools:    tools,
			ToolChoice: openai.ChatCompletionToolChoiceOptionUnionParam{
				OfAuto: openai.String("auto"),
			},
			MaxCompletionTokens: openai.Int(4096),
		})
		messageContent, refusal, streamedToolCalls, err := consumeStreamingResponse(stream, sendEvent)
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
			if content == "" {
				sendEvent(SSEEvent{Event: "error", Data: map[string]string{"message": "AI returned no content"}})
				return
			}
			return
		}

		messages = append(messages, streamedToolCallsToAssistantMessage(streamedToolCalls))

		// Process tool calls
		for _, tc := range streamedToolCalls {
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
				Data: map[string]interface{}{
					"tool": toolName,
					"args": args,
				},
			})

			// Mutation tools require user confirmation
			if MutationTools[toolName] {
				result, isError := AuthorizeTool(c, a.cs, toolName, args)
				if isError {
					sendEvent(SSEEvent{
						Event: "tool_result",
						Data: map[string]interface{}{
							"tool":   toolName,
							"result": result,
						},
					})
					messages = append(messages, openai.ToolMessage("Tool error: "+result, tc.ID))
					continue
				}
				sendEvent(SSEEvent{
					Event: "action_required",
					Data: map[string]interface{}{
						"tool": toolName,
						"args": args,
					},
				})
				return
			}

			result, isError := ExecuteTool(ctx, c, a.cs, toolName, args)

			sendEvent(SSEEvent{
				Event: "tool_result",
				Data: map[string]interface{}{
					"tool":   toolName,
					"result": result,
				},
			})

			if isError {
				result = "Tool error: " + result
			}
			messages = append(messages, openai.ToolMessage(result, tc.ID))
		}
	}

	sendEvent(SSEEvent{Event: "error", Data: map[string]string{"message": "Too many tool calling iterations"}})
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

func consumeStreamingResponse(
	stream interface {
		Next() bool
		Current() openai.ChatCompletionChunk
		Err() error
		Close() error
	},
	sendEvent func(SSEEvent),
) (string, string, []streamedToolCall, error) {
	defer func() {
		if err := stream.Close(); err != nil {
			klog.Warningf("Failed to close AI stream: %v", err)
		}
	}()

	var contentBuilder strings.Builder
	var refusalBuilder strings.Builder
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
		return "", "", nil, err
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

	return contentBuilder.String(), refusalBuilder.String(), toolCalls, nil
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

// MarshalSSEEvent marshals an SSE event to JSON for sending.
func MarshalSSEEvent(event SSEEvent) string {
	data, err := json.Marshal(event.Data)
	if err != nil {
		return "event: error\ndata: {\"message\":\"marshal error\"}\n\n"
	}
	return fmt.Sprintf("event: %s\ndata: %s\n\n", event.Event, string(data))
}
