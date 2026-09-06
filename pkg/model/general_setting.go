package model

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"

	"github.com/zxh326/kite/pkg/common"
	"gorm.io/gorm"
	"k8s.io/klog/v2"
)

const DefaultGeneralAIModel = "gpt-4o-mini"
const DefaultGeneralAnthropicModel = "claude-opus-5"
const DefaultGeneralKubectlImage = "zzde/kubectl:latest"
const DefaultGeneralNodeTerminalImage = "busybox:latest"
const DefaultGeneralClusterAgentImage = "ghcr.io/kite-org/kite:latest"

// Default max_tokens per provider. On current Claude models max_tokens is a
// ceiling on thinking + answer combined, and adaptive thinking spends from the
// same budget, so a small value truncates the answer mid-sentence. It is a
// ceiling, not an allocation — an unused ceiling costs nothing. gpt-4o-mini
// caps output at 16384, so the two providers cannot share one default.
//
// Depth is controlled by AIEffort (output_config.effort), not by max_tokens.
const (
	DefaultGeneralOpenAIMaxTokens    = 8192
	DefaultGeneralAnthropicMaxTokens = 64000
	// DefaultGeneralAIMaxTokens is the provider-agnostic fallback, kept at the
	// smaller value so an unknown provider never overshoots its model's cap.
	DefaultGeneralAIMaxTokens = DefaultGeneralOpenAIMaxTokens
)

// AI output effort levels, passed straight through as output_config.effort.
// This is the depth knob on current Claude models: budget_tokens was removed
// and returns 400, so effort is the only way to ask for more thinking.
const (
	GeneralAIEffortLow    = "low"
	GeneralAIEffortMedium = "medium"
	GeneralAIEffortHigh   = "high"
	GeneralAIEffortXHigh  = "xhigh"
	GeneralAIEffortMax    = "max"

	// DefaultGeneralAIEffort follows the guidance for agentic and coding work on
	// current Claude models, which is what the Kubernetes agent loop is.
	DefaultGeneralAIEffort = GeneralAIEffortXHigh
)

// GeneralAIEfforts lists the accepted effort levels, weakest first.
var GeneralAIEfforts = []string{
	GeneralAIEffortLow,
	GeneralAIEffortMedium,
	GeneralAIEffortHigh,
	GeneralAIEffortXHigh,
	GeneralAIEffortMax,
}

// NormalizeGeneralAIEffort maps an operator-supplied value onto a known level,
// falling back to the default rather than rejecting the save.
func NormalizeGeneralAIEffort(effort string) string {
	normalized := strings.ToLower(strings.TrimSpace(effort))
	for _, valid := range GeneralAIEfforts {
		if normalized == valid {
			return normalized
		}
	}
	return DefaultGeneralAIEffort
}

const GeneralAIProviderOpenAI = "openai"
const GeneralAIProviderAnthropic = "anthropic"
const DefaultGeneralAIProvider = GeneralAIProviderOpenAI

// DefaultGeneralAIMaxTokensByProvider mirrors DefaultGeneralAIModelByProvider:
// the default token budget follows the default model of the same provider.
func DefaultGeneralAIMaxTokensByProvider(provider string) int {
	switch NormalizeGeneralAIProvider(provider) {
	case GeneralAIProviderAnthropic:
		return DefaultGeneralAnthropicMaxTokens
	default:
		return DefaultGeneralOpenAIMaxTokens
	}
}

func DefaultGeneralNodeTerminalImageValue() string {
	image := strings.TrimSpace(common.NodeTerminalImage)
	if image == "" {
		return DefaultGeneralNodeTerminalImage
	}
	return image
}

func DefaultGeneralKubectlImageValue() string {
	image := strings.TrimSpace(common.KubectlTerminalImage)
	if image == "" {
		return DefaultGeneralKubectlImage
	}
	return image
}

func DefaultGeneralClusterAgentImageValue() string {
	image := strings.TrimSpace(common.ClusterAgentImage)
	if image == "" {
		return DefaultGeneralClusterAgentImage
	}
	return image
}

type GeneralSetting struct {
	Model
	AIAgentEnabled          bool         `json:"aiAgentEnabled" gorm:"column:ai_agent_enabled;type:boolean;not null;default:false"`
	AIProvider              string       `json:"aiProvider" gorm:"column:ai_provider;type:varchar(50);not null;default:'openai'"`
	AIModel                 string       `json:"aiModel" gorm:"column:ai_model;type:varchar(255);not null;default:'gpt-4o-mini'"`
	AIAPIKey                SecretString `json:"aiApiKey" gorm:"column:ai_api_key;type:text"`
	AIBaseURL               string       `json:"aiBaseUrl" gorm:"column:ai_base_url;type:varchar(500)"`
	AIMaxTokens             int          `json:"aiMaxTokens" gorm:"column:ai_max_tokens;type:integer;default:64000"`
	AIEffort                string       `json:"aiEffort" gorm:"column:ai_effort;type:varchar(20);not null;default:'xhigh'"`
	KubectlEnabled          bool         `json:"kubectlEnabled" gorm:"column:kubectl_enabled;type:boolean;not null;default:true"`
	KubectlImage            string       `json:"kubectlImage" gorm:"column:kubectl_image;type:varchar(255);not null;default:'zzde/kubectl:latest'"`
	NodeTerminalImage       string       `json:"nodeTerminalImage" gorm:"column:node_terminal_image;type:varchar(255);not null;default:'busybox:latest'"`
	ClusterAgentImage       string       `json:"clusterAgentImage" gorm:"column:cluster_agent_image;type:varchar(255);not null;default:'ghcr.io/kite-org/kite:latest'"`
	EnableAnalytics         bool         `json:"enableAnalytics" gorm:"column:enable_analytics;type:boolean;not null;default:false"`
	EnableVersionCheck      bool         `json:"enableVersionCheck" gorm:"column:enable_version_check;type:boolean;not null;default:true"`
	PasswordLoginDisabled   bool         `json:"passwordLoginDisabled" gorm:"column:password_login_disabled;type:boolean;not null;default:false"`
	EnableMFA               bool         `json:"enableMFA" gorm:"column:enable_mfa;type:boolean;not null;default:true"`
	EnablePasskeyLogin      bool         `json:"enablePasskeyLogin" gorm:"column:enable_passkey_login;type:boolean;not null;default:true"`
	LoginPrompt             string       `json:"loginPrompt" gorm:"column:login_prompt;type:text"`
	JWTSecret               SecretString `json:"-" gorm:"column:jwt_secret;type:text"`
	GlobalSidebarPreference string       `json:"-" gorm:"column:global_sidebar_preference;type:text"`
}

func NormalizeGeneralAIProvider(provider string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case GeneralAIProviderAnthropic:
		return GeneralAIProviderAnthropic
	default:
		return GeneralAIProviderOpenAI
	}
}

func IsGeneralAIProviderSupported(provider string) bool {
	normalized := strings.ToLower(strings.TrimSpace(provider))
	return normalized == GeneralAIProviderOpenAI || normalized == GeneralAIProviderAnthropic
}

func DefaultGeneralAIModelByProvider(provider string) string {
	switch NormalizeGeneralAIProvider(provider) {
	case GeneralAIProviderAnthropic:
		return DefaultGeneralAnthropicModel
	default:
		return DefaultGeneralAIModel
	}
}

func GetGeneralSetting() (*GeneralSetting, error) {
	var setting GeneralSetting
	err := DB.First(&setting, 1).Error
	if err == nil {
		updates := map[string]interface{}{}
		if setting.AIProvider == "" {
			setting.AIProvider = DefaultGeneralAIProvider
			updates["ai_provider"] = DefaultGeneralAIProvider
		} else {
			normalizedProvider := NormalizeGeneralAIProvider(setting.AIProvider)
			if setting.AIProvider != normalizedProvider {
				setting.AIProvider = normalizedProvider
				updates["ai_provider"] = normalizedProvider
			}
		}
		if setting.AIModel == "" {
			setting.AIModel = DefaultGeneralAIModelByProvider(setting.AIProvider)
			updates["ai_model"] = setting.AIModel
		}
		if normalizedEffort := NormalizeGeneralAIEffort(setting.AIEffort); setting.AIEffort != normalizedEffort {
			// Covers both an upgraded install (empty column) and a stale value.
			setting.AIEffort = normalizedEffort
			updates["ai_effort"] = normalizedEffort
		}
		if setting.KubectlImage == "" {
			setting.KubectlImage = DefaultGeneralKubectlImageValue()
			updates["kubectl_image"] = setting.KubectlImage
		}
		if setting.NodeTerminalImage == "" {
			setting.NodeTerminalImage = DefaultGeneralNodeTerminalImageValue()
			updates["node_terminal_image"] = setting.NodeTerminalImage
		}
		if setting.ClusterAgentImage == "" {
			setting.ClusterAgentImage = DefaultGeneralClusterAgentImageValue()
			updates["cluster_agent_image"] = setting.ClusterAgentImage
		}
		if err := ensureJWTSecret(&setting, updates); err != nil {
			return nil, err
		}
		if len(updates) > 0 {
			if err := DB.Model(&setting).Updates(updates).Error; err != nil {
				return nil, err
			}
		}
		applyRuntimeGeneralSetting(&setting)
		return &setting, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	setting = GeneralSetting{
		Model:              Model{ID: 1},
		AIAgentEnabled:     false,
		AIProvider:         DefaultGeneralAIProvider,
		AIModel:            DefaultGeneralAIModel,
		AIMaxTokens:        DefaultGeneralAIMaxTokensByProvider(DefaultGeneralAIProvider),
		AIEffort:           DefaultGeneralAIEffort,
		KubectlEnabled:     true,
		KubectlImage:       DefaultGeneralKubectlImageValue(),
		NodeTerminalImage:  DefaultGeneralNodeTerminalImageValue(),
		ClusterAgentImage:  DefaultGeneralClusterAgentImageValue(),
		EnableAnalytics:    common.EnableAnalytics,
		EnableVersionCheck: common.EnableVersionCheck,
		EnableMFA:          true,
		EnablePasskeyLogin: true,
	}
	if err := ensureJWTSecret(&setting, nil); err != nil {
		return nil, err
	}
	if err := DB.Create(&setting).Error; err != nil {
		return nil, err
	}
	applyRuntimeGeneralSetting(&setting)
	return &setting, nil
}

func UpdateGeneralSetting(updates map[string]interface{}) (*GeneralSetting, error) {
	setting, err := GetGeneralSetting()
	if err != nil {
		return nil, err
	}
	if err := DB.Model(setting).Updates(updates).Error; err != nil {
		return nil, err
	}
	if err := DB.First(setting, setting.ID).Error; err != nil {
		return nil, err
	}
	applyRuntimeGeneralSetting(setting)
	return setting, nil
}

func applyRuntimeGeneralSetting(setting *GeneralSetting) {
	if setting == nil {
		return
	}
	common.EnableAnalytics = setting.EnableAnalytics
	common.EnableVersionCheck = setting.EnableVersionCheck
}

func ensureJWTSecret(setting *GeneralSetting, updates map[string]interface{}) error {
	storedSecret := strings.TrimSpace(string(setting.JWTSecret))
	configuredSecret := strings.TrimSpace(common.JwtSecret)

	switch {
	case configuredSecret != "" && configuredSecret != common.DefaultJWTSecret:
		if storedSecret != configuredSecret {
			setting.JWTSecret = SecretString(configuredSecret)
			if updates != nil {
				updates["jwt_secret"] = setting.JWTSecret
			}
		}
		common.JwtSecret = configuredSecret
		return nil
	case storedSecret != "" && storedSecret != common.DefaultJWTSecret:
		common.JwtSecret = storedSecret
		return nil
	default:
		generatedSecret, err := generateJWTSecret()
		if err != nil {
			return err
		}
		setting.JWTSecret = SecretString(generatedSecret)
		common.JwtSecret = generatedSecret
		if updates != nil {
			updates["jwt_secret"] = setting.JWTSecret
		}
		klog.Warningf("JWT secret is using the insecure default value, generated a random secret and stored it in general setting")
		return nil
	}
}

func generateJWTSecret() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
