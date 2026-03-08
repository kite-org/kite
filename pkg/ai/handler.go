package ai

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/model"
)

// HandleAIStatus returns whether AI features are enabled.
func HandleAIStatus(c *gin.Context) {
	cfg, err := LoadRuntimeConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to load AI config: %v", err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"enabled":  cfg.Enabled,
		"provider": cfg.Provider,
		"model":    cfg.Model,
	})
}

// HandleChat handles the SSE streaming chat endpoint.
func HandleChat(c *gin.Context) {
	cfg, err := LoadRuntimeConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to load AI config: %v", err)})
		return
	}
	if !cfg.Enabled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI is not enabled"})
		return
	}

	var req ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid request: %v", err)})
		return
	}
	req.Language = detectRequestLanguage(req.Language, c.GetHeader("Accept-Language"))

	if len(req.Messages) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No messages provided"})
		return
	}

	clientSet, ok := getClusterClientSet(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No cluster selected"})
		return
	}

	agent, err := NewAgent(clientSet, cfg)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to create AI agent: %v", err)})
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Streaming not supported"})
		return
	}

	sendEvent := func(event SSEEvent) {
		data := MarshalSSEEvent(event)
		_, _ = fmt.Fprint(c.Writer, data)
		flusher.Flush()
	}

	agent.ProcessChat(c, &req, sendEvent)

	sendEvent(SSEEvent{Event: "done", Data: map[string]string{}})
}

// ExecuteRequest is the request body for the stateless execute endpoint.
type ExecuteRequest struct {
	Tool string                 `json:"tool"`
	Args map[string]interface{} `json:"args"`
}

// HandleExecute executes a confirmed mutation action. Stateless — the client
// sends the full tool name and args, no server-side session needed.
func HandleExecute(c *gin.Context) {
	cfg, err := LoadRuntimeConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to load AI config: %v", err)})
		return
	}
	if !cfg.Enabled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI is not enabled"})
		return
	}

	var req ExecuteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid request: %v", err)})
		return
	}

	if !MutationTools[req.Tool] {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Tool %s is not a mutation tool", req.Tool)})
		return
	}

	clientSet, ok := getClusterClientSet(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No cluster selected"})
		return
	}

	result, isError := ExecuteTool(c.Request.Context(), c, clientSet, req.Tool, req.Args)
	if isError {
		statusCode := http.StatusInternalServerError
		if strings.HasPrefix(result, "Forbidden: ") {
			statusCode = http.StatusForbidden
		} else if strings.HasPrefix(result, "Error: ") || strings.HasPrefix(result, "Unknown tool: ") {
			statusCode = http.StatusBadRequest
		}
		c.JSON(statusCode, gin.H{
			"status":  "error",
			"message": result,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "ok",
		"message": result,
	})
}

func HandleGetGeneralSetting(c *gin.Context) {
	setting, err := model.GetGeneralSetting()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to load general setting: %v", err)})
		return
	}
	hasAIAPIKey := strings.TrimSpace(string(setting.AIAPIKey)) != ""
	c.JSON(http.StatusOK, gin.H{
		"aiAgentEnabled":     setting.AIAgentEnabled,
		"aiProvider":         setting.AIProvider,
		"aiModel":            setting.AIModel,
		"aiApiKey":           "",
		"aiApiKeyConfigured": hasAIAPIKey,
		"aiBaseUrl":          setting.AIBaseURL,
		"aiMaxTokens":        setting.AIMaxTokens,
		"kubectlEnabled":     setting.KubectlEnabled,
		"kubectlImage":       setting.KubectlImage,
		"nodeTerminalImage":  setting.NodeTerminalImage,
		"enableAnalytics":    setting.EnableAnalytics,
		"enableVersionCheck": setting.EnableVersionCheck,
	})
}

type UpdateGeneralSettingRequest struct {
	AIAgentEnabled     bool    `json:"aiAgentEnabled"`
	AIProvider         string  `json:"aiProvider"`
	AIModel            string  `json:"aiModel"`
	AIAPIKey           *string `json:"aiApiKey"`
	AIBaseURL          string  `json:"aiBaseUrl"`
	AIMaxTokens        int     `json:"aiMaxTokens"`
	KubectlEnabled     bool    `json:"kubectlEnabled"`
	KubectlImage       string  `json:"kubectlImage"`
	NodeTerminalImage  string  `json:"nodeTerminalImage"`
	EnableAnalytics    bool    `json:"enableAnalytics"`
	EnableVersionCheck bool    `json:"enableVersionCheck"`
}

func HandleUpdateGeneralSetting(c *gin.Context) {
	var req UpdateGeneralSettingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid request: %v", err)})
		return
	}
	currentSetting, err := model.GetGeneralSetting()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to load general setting: %v", err)})
		return
	}

	aiProvider := strings.ToLower(strings.TrimSpace(req.AIProvider))
	if aiProvider == "" {
		aiProvider = currentSetting.AIProvider
	}
	if !model.IsGeneralAIProviderSupported(aiProvider) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported aiProvider"})
		return
	}
	aiProvider = normalizeProvider(aiProvider)

	aiModel := strings.TrimSpace(req.AIModel)
	if aiModel == "" {
		aiModel = model.DefaultGeneralAIModelByProvider(aiProvider)
	}
	aiAPIKey := strings.TrimSpace(string(currentSetting.AIAPIKey))
	shouldUpdateAIAPIKey := false
	if req.AIAPIKey != nil {
		incomingKey := strings.TrimSpace(*req.AIAPIKey)
		if incomingKey != "" {
			aiAPIKey = incomingKey
			shouldUpdateAIAPIKey = true
		}
	}
	if req.AIAgentEnabled && aiAPIKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "aiApiKey is required when aiAgentEnabled is true"})
		return
	}

	kubectlImage := strings.TrimSpace(req.KubectlImage)
	if req.KubectlEnabled && strings.TrimSpace(req.KubectlImage) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kubectlImage is required when kubectlEnabled is true"})
		return
	}
	if kubectlImage == "" {
		kubectlImage = model.DefaultGeneralKubectlImage
	}
	nodeTerminalImage := strings.TrimSpace(req.NodeTerminalImage)
	if nodeTerminalImage == "" {
		nodeTerminalImage = strings.TrimSpace(currentSetting.NodeTerminalImage)
	}
	if nodeTerminalImage == "" {
		nodeTerminalImage = model.DefaultGeneralNodeTerminalImageValue()
	}

	aiMaxTokens := req.AIMaxTokens
	if aiMaxTokens <= 0 {
		aiMaxTokens = 4096
	}

	updates := map[string]interface{}{
		"ai_agent_enabled":     req.AIAgentEnabled,
		"ai_provider":          aiProvider,
		"ai_model":             aiModel,
		"ai_base_url":          strings.TrimSpace(req.AIBaseURL),
		"ai_max_tokens":        aiMaxTokens,
		"kubectl_enabled":      req.KubectlEnabled,
		"kubectl_image":        kubectlImage,
		"node_terminal_image":  nodeTerminalImage,
		"enable_analytics":     req.EnableAnalytics,
		"enable_version_check": req.EnableVersionCheck,
	}
	if shouldUpdateAIAPIKey {
		updates["ai_api_key"] = model.SecretString(aiAPIKey)
	}

	updated, err := model.UpdateGeneralSetting(updates)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to update general setting: %v", err)})
		return
	}

	hasAIAPIKey := strings.TrimSpace(string(updated.AIAPIKey)) != ""
	c.JSON(http.StatusOK, gin.H{
		"aiAgentEnabled":     updated.AIAgentEnabled,
		"aiProvider":         updated.AIProvider,
		"aiModel":            updated.AIModel,
		"aiApiKey":           "",
		"aiApiKeyConfigured": hasAIAPIKey,
		"aiBaseUrl":          updated.AIBaseURL,
		"aiMaxTokens":        updated.AIMaxTokens,
		"kubectlEnabled":     updated.KubectlEnabled,
		"kubectlImage":       updated.KubectlImage,
		"nodeTerminalImage":  updated.NodeTerminalImage,
		"enableAnalytics":    updated.EnableAnalytics,
		"enableVersionCheck": updated.EnableVersionCheck,
	})
}

func getClusterClientSet(c *gin.Context) (*cluster.ClientSet, bool) {
	cs, exists := c.Get("cluster")
	if !exists {
		return nil, false
	}
	clientSet, ok := cs.(*cluster.ClientSet)
	return clientSet, ok
}
