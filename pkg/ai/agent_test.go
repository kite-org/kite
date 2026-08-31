package ai

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
)

func TestNormalizeAgentMessages(t *testing.T) {
	longContent := strings.Repeat("a", maxMessageChars+10)
	messages := make([]AgentMessage, 0, maxConversationMessages+2)
	messages = append(messages, AgentMessage{Role: messageRoleUser, Content: []ContentBlock{{Type: contentBlockText, Text: "   "}}})
	for i := 0; i < maxConversationMessages+1; i++ {
		content := "  hello  "
		if i == maxConversationMessages {
			content = longContent
		}
		role := "user"
		if i%2 == 0 {
			role = messageRoleAssistant
		}
		messages = append(messages, AgentMessage{Role: role, Content: []ContentBlock{{Type: contentBlockText, Text: content}}})
	}

	normalized := normalizeAgentMessages(messages)
	if len(normalized) != maxConversationMessages {
		t.Fatalf("expected %d messages, got %d", maxConversationMessages, len(normalized))
	}
	if normalized[0].Content[0].Text != "hello" {
		t.Fatalf("expected trimmed content, got %q", normalized[0].Content[0].Text)
	}
	if normalized[0].Role != messageRoleUser && normalized[0].Role != messageRoleAssistant {
		t.Fatalf("unexpected role: %s", normalized[0].Role)
	}
	if len(normalized[len(normalized)-1].Content[0].Text) != maxMessageChars {
		t.Fatalf("expected truncated message length %d, got %d", maxMessageChars, len(normalized[len(normalized)-1].Content[0].Text))
	}
}

func TestSummarizeScope(t *testing.T) {
	if got := summarizeScope(nil); got != "-" {
		t.Fatalf("expected -, got %q", got)
	}
	if got := summarizeScope([]string{"pods"}); got != "pods" {
		t.Fatalf("expected pods, got %q", got)
	}
	if got := summarizeScope([]string{"get"}); got != "get,list,watch" {
		t.Fatalf("expected get,list,watch, got %q", got)
	}
}

func TestBuildRBACOverview(t *testing.T) {
	user := model.User{
		Username: "alice",
		Roles: []common.Role{
			{
				Name:       "viewer",
				Clusters:   []string{"cluster-b"},
				Namespaces: []string{"get"},
				Resources:  []string{"pods"},
				Verbs:      []string{"get"},
			},
			{
				Name:       "admin",
				Clusters:   []string{"cluster-a"},
				Namespaces: []string{"default"},
				Resources:  []string{"deployments"},
				Verbs:      []string{"update"},
			},
		},
	}

	got := buildRBACOverview(user)
	want := "admin[clusters=cluster-a;namespaces=default;resources=deployments;verbs=update] | viewer[clusters=cluster-b;namespaces=get,list,watch;resources=pods;verbs=get,list,watch]"
	if got != want {
		t.Fatalf("unexpected rbac overview:\nwant: %s\ngot:  %s", want, got)
	}
}

func TestBuildRuntimePromptContext(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("user", model.User{
		Username: "alice",
		Roles: []common.Role{
			{
				Name:       "viewer",
				Clusters:   []string{"cluster-a"},
				Namespaces: []string{"default"},
				Resources:  []string{"pods"},
				Verbs:      []string{"get"},
			},
		},
	})

	ctx := buildRuntimePromptContext(c, &cluster.ClientSet{Name: "cluster-a"})
	if ctx.ClusterName != "cluster-a" {
		t.Fatalf("expected cluster-a, got %q", ctx.ClusterName)
	}
	if ctx.AccountName != "alice" {
		t.Fatalf("expected alice, got %q", ctx.AccountName)
	}
	if !strings.Contains(ctx.RBACOverview, "viewer[clusters=cluster-a") {
		t.Fatalf("unexpected RBAC overview: %s", ctx.RBACOverview)
	}
}

func TestBuildContextualSystemPrompt(t *testing.T) {
	prompt := buildContextualSystemPrompt(
		&PageContext{Page: "pod-detail", Namespace: "default", ResourceKind: "Pod", ResourceName: "nginx"},
		runtimePromptContext{ClusterName: "cluster-a", AccountName: "alice", RBACOverview: "viewer[...]"},
		"zh",
	)

	checks := []string{
		"Current runtime context:",
		"Current cluster: cluster-a",
		"Current account name: alice",
		"Current page context:",
		"Current resource: Pod/nginx",
		"Current namespace: default",
		"Focus on this pod's status, logs, events, and health. Proactively check for issues.",
		"Response language:",
		"respond in Simplified Chinese unless the user explicitly asks for another language.",
	}
	for _, want := range checks {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q", want)
		}
	}
}

func TestParseToolCallArguments(t *testing.T) {
	args, err := parseToolCallArguments(`{"name":"nginx","replicas":3}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if args["name"] != "nginx" {
		t.Fatalf("unexpected name: %#v", args["name"])
	}
	if args["replicas"].(float64) != 3 {
		t.Fatalf("unexpected replicas: %#v", args["replicas"])
	}

	empty, err := parseToolCallArguments("  ")
	if err != nil {
		t.Fatalf("unexpected error for empty input: %v", err)
	}
	if len(empty) != 0 {
		t.Fatalf("expected empty args, got %#v", empty)
	}
}

func TestMarshalSSEEvent(t *testing.T) {
	got := MarshalSSEEvent(AgentEvent{Type: "message_delta", Data: MessageDeltaEvent{BlockType: contentBlockText, Content: "hello"}})
	want := "event: message_delta\ndata: {\"block_type\":\"text\",\"content\":\"hello\"}\n\n"
	if got != want {
		t.Fatalf("unexpected SSE output:\nwant: %q\ngot:  %q", want, got)
	}
}
