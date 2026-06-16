package settings

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/model"
)

func HandleGetGeneralSetting(c *gin.Context) {
	setting, err := model.GetGeneralSetting()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to load general setting: %v", err)})
		return
	}
	hasAIAPIKey := strings.TrimSpace(string(setting.AIAPIKey)) != ""
	c.JSON(http.StatusOK, gin.H{
		"aiAgentEnabled":        setting.AIAgentEnabled,
		"aiProvider":            setting.AIProvider,
		"aiModel":               setting.AIModel,
		"aiApiKey":              "",
		"aiApiKeyConfigured":    hasAIAPIKey,
		"aiBaseUrl":             setting.AIBaseURL,
		"aiMaxTokens":           setting.AIMaxTokens,
		"kubectlEnabled":        setting.KubectlEnabled,
		"kubectlImage":          setting.KubectlImage,
		"nodeTerminalImage":     setting.NodeTerminalImage,
		"enableAnalytics":       setting.EnableAnalytics,
		"enableVersionCheck":    setting.EnableVersionCheck,
		"passwordLoginDisabled": setting.PasswordLoginDisabled,
		"enableMFA":             setting.EnableMFA,
		"enablePasskeyLogin":    setting.EnablePasskeyLogin,
		"loginPrompt":           setting.LoginPrompt,
	})
}

type UpdateGeneralSettingRequest struct {
	AIAgentEnabled        *bool   `json:"aiAgentEnabled"`
	AIProvider            *string `json:"aiProvider"`
	AIModel               *string `json:"aiModel"`
	AIAPIKey              *string `json:"aiApiKey"`
	AIBaseURL             *string `json:"aiBaseUrl"`
	AIMaxTokens           *int    `json:"aiMaxTokens"`
	KubectlEnabled        *bool   `json:"kubectlEnabled"`
	KubectlImage          *string `json:"kubectlImage"`
	NodeTerminalImage     *string `json:"nodeTerminalImage"`
	EnableAnalytics       *bool   `json:"enableAnalytics"`
	EnableVersionCheck    *bool   `json:"enableVersionCheck"`
	PasswordLoginDisabled *bool   `json:"passwordLoginDisabled"`
	EnableMFA             *bool   `json:"enableMFA"`
	EnablePasskeyLogin    *bool   `json:"enablePasskeyLogin"`
	LoginPrompt           *string `json:"loginPrompt"`
}

func HandleUpdateGeneralSetting(c *gin.Context) { //nolint:gocyclo
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

	aiProvider := model.NormalizeGeneralAIProvider(currentSetting.AIProvider)
	if req.AIProvider != nil {
		incomingProvider := strings.ToLower(strings.TrimSpace(*req.AIProvider))
		if incomingProvider != "" {
			if !model.IsGeneralAIProviderSupported(incomingProvider) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported aiProvider"})
				return
			}
			aiProvider = model.NormalizeGeneralAIProvider(incomingProvider)
		}
	}

	aiModel := strings.TrimSpace(currentSetting.AIModel)
	if req.AIModel != nil {
		aiModel = strings.TrimSpace(*req.AIModel)
	}
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
	aiAgentEnabled := currentSetting.AIAgentEnabled
	if req.AIAgentEnabled != nil {
		aiAgentEnabled = *req.AIAgentEnabled
	}
	if aiAgentEnabled && aiAPIKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "aiApiKey is required when aiAgentEnabled is true"})
		return
	}

	kubectlEnabled := currentSetting.KubectlEnabled
	if req.KubectlEnabled != nil {
		kubectlEnabled = *req.KubectlEnabled
	}
	kubectlImage := strings.TrimSpace(currentSetting.KubectlImage)
	if req.KubectlImage != nil {
		kubectlImage = strings.TrimSpace(*req.KubectlImage)
	}
	if kubectlEnabled && req.KubectlImage != nil && strings.TrimSpace(*req.KubectlImage) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kubectlImage is required when kubectlEnabled is true"})
		return
	}
	if kubectlImage == "" {
		kubectlImage = model.DefaultGeneralKubectlImage
	}
	nodeTerminalImage := strings.TrimSpace(currentSetting.NodeTerminalImage)
	if req.NodeTerminalImage != nil {
		nodeTerminalImage = strings.TrimSpace(*req.NodeTerminalImage)
	}
	if nodeTerminalImage == "" {
		nodeTerminalImage = model.DefaultGeneralNodeTerminalImageValue()
	}

	aiMaxTokens := currentSetting.AIMaxTokens
	if req.AIMaxTokens != nil {
		aiMaxTokens = *req.AIMaxTokens
	}
	if aiMaxTokens <= 0 {
		aiMaxTokens = 4096
	}

	updates := map[string]interface{}{}
	if req.AIAgentEnabled != nil {
		updates["ai_agent_enabled"] = aiAgentEnabled
	}
	if req.AIProvider != nil {
		updates["ai_provider"] = aiProvider
	}
	if req.AIModel != nil {
		updates["ai_model"] = aiModel
	}
	if req.AIBaseURL != nil {
		updates["ai_base_url"] = strings.TrimSpace(*req.AIBaseURL)
	}
	if req.AIMaxTokens != nil {
		updates["ai_max_tokens"] = aiMaxTokens
	}
	if req.KubectlEnabled != nil {
		updates["kubectl_enabled"] = kubectlEnabled
	}
	if req.KubectlImage != nil {
		updates["kubectl_image"] = kubectlImage
	}
	if req.NodeTerminalImage != nil {
		updates["node_terminal_image"] = nodeTerminalImage
	}
	if req.EnableAnalytics != nil {
		updates["enable_analytics"] = *req.EnableAnalytics
	}
	if req.EnableVersionCheck != nil {
		updates["enable_version_check"] = *req.EnableVersionCheck
	}
	if req.LoginPrompt != nil {
		updates["login_prompt"] = strings.TrimSpace(*req.LoginPrompt)
	}
	if req.PasswordLoginDisabled != nil {
		updates["password_login_disabled"] = *req.PasswordLoginDisabled
	}
	if req.EnableMFA != nil {
		updates["enable_mfa"] = *req.EnableMFA
	}
	if req.EnablePasskeyLogin != nil {
		updates["enable_passkey_login"] = *req.EnablePasskeyLogin
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
		"aiAgentEnabled":        updated.AIAgentEnabled,
		"aiProvider":            updated.AIProvider,
		"aiModel":               updated.AIModel,
		"aiApiKey":              "",
		"aiApiKeyConfigured":    hasAIAPIKey,
		"aiBaseUrl":             updated.AIBaseURL,
		"aiMaxTokens":           updated.AIMaxTokens,
		"kubectlEnabled":        updated.KubectlEnabled,
		"kubectlImage":          updated.KubectlImage,
		"nodeTerminalImage":     updated.NodeTerminalImage,
		"enableAnalytics":       updated.EnableAnalytics,
		"enableVersionCheck":    updated.EnableVersionCheck,
		"passwordLoginDisabled": updated.PasswordLoginDisabled,
		"enableMFA":             updated.EnableMFA,
		"enablePasskeyLogin":    updated.EnablePasskeyLogin,
		"loginPrompt":           updated.LoginPrompt,
	})
}
