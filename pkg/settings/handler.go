package settings

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
)

func HandleGetGeneralSetting(c *gin.Context) {
	setting, err := model.GetGeneralSetting()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to load general setting: %v", err)})
		return
	}
	writeGeneralSettingResponse(c, setting)
}

func writeGeneralSettingResponse(c *gin.Context, setting *model.GeneralSetting) {
	hasAIAPIKey := strings.TrimSpace(string(setting.AIAPIKey)) != ""
	hasSMTPPassword := strings.TrimSpace(string(setting.SMTPPassword)) != ""
	c.JSON(http.StatusOK, gin.H{
		"aiAgentEnabled":         setting.AIAgentEnabled,
		"aiProvider":             setting.AIProvider,
		"aiModel":                setting.AIModel,
		"aiApiKey":               "",
		"aiApiKeyConfigured":     hasAIAPIKey,
		"aiBaseUrl":              setting.AIBaseURL,
		"aiMaxTokens":            setting.AIMaxTokens,
		"kubectlEnabled":         setting.KubectlEnabled,
		"kubectlImage":           setting.KubectlImage,
		"nodeTerminalImage":      setting.NodeTerminalImage,
		"clusterAgentImage":      setting.ClusterAgentImage,
		"enableAnalytics":        setting.EnableAnalytics,
		"enableVersionCheck":     setting.EnableVersionCheck,
		"passwordLoginDisabled":  setting.PasswordLoginDisabled,
		"enableMFA":              setting.EnableMFA,
		"enablePasskeyLogin":     setting.EnablePasskeyLogin,
		"loginPrompt":            setting.LoginPrompt,
		"smtpEnabled":            setting.SMTPEnabled,
		"smtpHost":               setting.SMTPHost,
		"smtpPort":               setting.SMTPPort,
		"smtpUsername":           setting.SMTPUsername,
		"smtpPasswordConfigured": hasSMTPPassword,
		"smtpFromEmail":          setting.SMTPFromEmail,
		"smtpFromName":           setting.SMTPFromName,
		"smtpEncryption":         setting.SMTPEncryption,
		"smtpSkipTLSVerify":      setting.SMTPSkipTLSVerify,
		"smtpTimeoutSeconds":     setting.SMTPTimeoutSeconds,
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
	ClusterAgentImage     *string `json:"clusterAgentImage"`
	EnableAnalytics       *bool   `json:"enableAnalytics"`
	EnableVersionCheck    *bool   `json:"enableVersionCheck"`
	PasswordLoginDisabled *bool   `json:"passwordLoginDisabled"`
	EnableMFA             *bool   `json:"enableMFA"`
	EnablePasskeyLogin    *bool   `json:"enablePasskeyLogin"`
	LoginPrompt           *string `json:"loginPrompt"`
	SMTPEnabled           *bool   `json:"smtpEnabled"`
	SMTPHost              *string `json:"smtpHost"`
	SMTPPort              *int    `json:"smtpPort"`
	SMTPUsername          *string `json:"smtpUsername"`
	SMTPPassword          *string `json:"smtpPassword"`
	SMTPClearPassword     *bool   `json:"smtpClearPassword"`
	SMTPFromEmail         *string `json:"smtpFromEmail"`
	SMTPFromName          *string `json:"smtpFromName"`
	SMTPEncryption        *string `json:"smtpEncryption"`
	SMTPSkipTLSVerify     *bool   `json:"smtpSkipTLSVerify"`
	SMTPTimeoutSeconds    *int    `json:"smtpTimeoutSeconds"`
}

func HandleUpdateGeneralSetting(c *gin.Context) { //nolint:gocyclo
	var req UpdateGeneralSettingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid request: %v", err)})
		return
	}
	if common.IsSectionManaged("smtp") && (req.SMTPEnabled != nil || req.SMTPHost != nil || req.SMTPPort != nil || req.SMTPUsername != nil || req.SMTPPassword != nil || req.SMTPClearPassword != nil || req.SMTPFromEmail != nil || req.SMTPFromName != nil || req.SMTPEncryption != nil || req.SMTPSkipTLSVerify != nil || req.SMTPTimeoutSeconds != nil) {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
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
		if incomingKey := strings.TrimSpace(*req.AIAPIKey); incomingKey != "" {
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
		kubectlImage = model.DefaultGeneralKubectlImageValue()
	}
	nodeTerminalImage := strings.TrimSpace(currentSetting.NodeTerminalImage)
	if req.NodeTerminalImage != nil {
		nodeTerminalImage = strings.TrimSpace(*req.NodeTerminalImage)
	}
	if nodeTerminalImage == "" {
		nodeTerminalImage = model.DefaultGeneralNodeTerminalImageValue()
	}
	clusterAgentImage := strings.TrimSpace(currentSetting.ClusterAgentImage)
	if req.ClusterAgentImage != nil {
		clusterAgentImage = strings.TrimSpace(*req.ClusterAgentImage)
	}
	if clusterAgentImage == "" {
		clusterAgentImage = model.DefaultGeneralClusterAgentImageValue()
	}
	aiMaxTokens := currentSetting.AIMaxTokens
	if req.AIMaxTokens != nil {
		aiMaxTokens = *req.AIMaxTokens
	}
	if aiMaxTokens <= 0 {
		aiMaxTokens = 16384
	}

	smtpSetting := *currentSetting
	if req.SMTPEnabled != nil {
		smtpSetting.SMTPEnabled = *req.SMTPEnabled
	}
	if req.SMTPHost != nil {
		smtpSetting.SMTPHost = strings.TrimSpace(*req.SMTPHost)
	}
	if req.SMTPPort != nil {
		smtpSetting.SMTPPort = *req.SMTPPort
	}
	if req.SMTPUsername != nil {
		smtpSetting.SMTPUsername = strings.TrimSpace(*req.SMTPUsername)
	}
	if req.SMTPFromEmail != nil {
		smtpSetting.SMTPFromEmail = strings.TrimSpace(*req.SMTPFromEmail)
	}
	if req.SMTPFromName != nil {
		smtpSetting.SMTPFromName = strings.TrimSpace(*req.SMTPFromName)
	}
	if req.SMTPEncryption != nil {
		smtpSetting.SMTPEncryption = normalizeSMTPEncryption(*req.SMTPEncryption)
	}
	if req.SMTPSkipTLSVerify != nil {
		smtpSetting.SMTPSkipTLSVerify = *req.SMTPSkipTLSVerify
	}
	if req.SMTPTimeoutSeconds != nil {
		smtpSetting.SMTPTimeoutSeconds = *req.SMTPTimeoutSeconds
	}
	if err := validateSMTPSetting(&smtpSetting); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
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
	if req.ClusterAgentImage != nil {
		updates["cluster_agent_image"] = clusterAgentImage
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
	if req.SMTPEnabled != nil {
		updates["smtp_enabled"] = smtpSetting.SMTPEnabled
	}
	if req.SMTPHost != nil {
		updates["smtp_host"] = smtpSetting.SMTPHost
	}
	if req.SMTPPort != nil {
		updates["smtp_port"] = smtpSetting.SMTPPort
	}
	if req.SMTPUsername != nil {
		updates["smtp_username"] = smtpSetting.SMTPUsername
	}
	if req.SMTPFromEmail != nil {
		updates["smtp_from_email"] = smtpSetting.SMTPFromEmail
	}
	if req.SMTPFromName != nil {
		updates["smtp_from_name"] = smtpSetting.SMTPFromName
	}
	if req.SMTPEncryption != nil {
		updates["smtp_encryption"] = smtpSetting.SMTPEncryption
	}
	if req.SMTPSkipTLSVerify != nil {
		updates["smtp_skip_tls_verify"] = smtpSetting.SMTPSkipTLSVerify
	}
	if req.SMTPTimeoutSeconds != nil {
		updates["smtp_timeout_seconds"] = smtpSetting.SMTPTimeoutSeconds
	}
	if req.SMTPClearPassword != nil && *req.SMTPClearPassword {
		updates["smtp_password"] = model.SecretString("")
	} else if req.SMTPPassword != nil {
		if password := strings.TrimSpace(*req.SMTPPassword); password != "" {
			updates["smtp_password"] = model.SecretString(password)
		}
	}

	updated, err := model.UpdateGeneralSetting(updates)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to update general setting: %v", err)})
		return
	}
	writeGeneralSettingResponse(c, updated)
}

type SMTPTestRequest struct {
	Recipient          string  `json:"recipient"`
	SMTPEnabled        *bool   `json:"smtpEnabled"`
	SMTPHost           *string `json:"smtpHost"`
	SMTPPort           *int    `json:"smtpPort"`
	SMTPUsername       *string `json:"smtpUsername"`
	SMTPPassword       *string `json:"smtpPassword"`
	SMTPFromEmail      *string `json:"smtpFromEmail"`
	SMTPFromName       *string `json:"smtpFromName"`
	SMTPEncryption     *string `json:"smtpEncryption"`
	SMTPSkipTLSVerify  *bool   `json:"smtpSkipTLSVerify"`
	SMTPTimeoutSeconds *int    `json:"smtpTimeoutSeconds"`
}

func (req SMTPTestRequest) hasSMTPOverride() bool {
	return req.SMTPEnabled != nil || req.SMTPHost != nil || req.SMTPPort != nil || req.SMTPUsername != nil || req.SMTPPassword != nil || req.SMTPFromEmail != nil || req.SMTPFromName != nil || req.SMTPEncryption != nil || req.SMTPSkipTLSVerify != nil || req.SMTPTimeoutSeconds != nil
}

func (req SMTPTestRequest) applySMTPOverride(setting *model.GeneralSetting) {
	if req.SMTPEnabled != nil {
		setting.SMTPEnabled = *req.SMTPEnabled
	}
	if req.SMTPHost != nil {
		setting.SMTPHost = strings.TrimSpace(*req.SMTPHost)
	}
	if req.SMTPPort != nil {
		setting.SMTPPort = *req.SMTPPort
	}
	if req.SMTPUsername != nil {
		setting.SMTPUsername = strings.TrimSpace(*req.SMTPUsername)
	}
	if req.SMTPPassword != nil {
		if password := strings.TrimSpace(*req.SMTPPassword); password != "" {
			setting.SMTPPassword = model.SecretString(password)
		}
	}
	if req.SMTPFromEmail != nil {
		setting.SMTPFromEmail = strings.TrimSpace(*req.SMTPFromEmail)
	}
	if req.SMTPFromName != nil {
		setting.SMTPFromName = strings.TrimSpace(*req.SMTPFromName)
	}
	if req.SMTPEncryption != nil {
		setting.SMTPEncryption = normalizeSMTPEncryption(*req.SMTPEncryption)
	}
	if req.SMTPSkipTLSVerify != nil {
		setting.SMTPSkipTLSVerify = *req.SMTPSkipTLSVerify
	}
	if req.SMTPTimeoutSeconds != nil {
		setting.SMTPTimeoutSeconds = *req.SMTPTimeoutSeconds
	}
}

func HandleTestSMTP(c *gin.Context) {
	var req SMTPTestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid request: %v", err)})
		return
	}
	recipient := strings.TrimSpace(req.Recipient)
	if !isValidEmail(recipient) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "recipient must be a valid email address"})
		return
	}
	setting, err := model.GetGeneralSetting()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to load general setting: %v", err)})
		return
	}
	if req.hasSMTPOverride() {
		temporarySetting := *setting
		req.applySMTPOverride(&temporarySetting)
		setting = &temporarySetting
		if err := validateSMTPSetting(setting); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}
	if !setting.SMTPEnabled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "SMTP is not enabled"})
		return
	}
	if err := sendSMTPTestEmail(c.Request.Context(), setting, recipient); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to send SMTP test email"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
