package model

import (
	"errors"
	"strings"

	"github.com/zxh326/kite/pkg/common"
	"gorm.io/gorm"
)

const DefaultGeneralAIModel = "gpt-4o-mini"
const DefaultGeneralAnthropicModel = "claude-sonnet-4-5"
const DefaultGeneralKubectlImage = "zzde/kubectl:latest"
const DefaultGeneralNodeTerminalImage = "busybox:latest"

const GeneralAIProviderOpenAI = "openai"
const GeneralAIProviderAnthropic = "anthropic"
const DefaultGeneralAIProvider = GeneralAIProviderOpenAI

func DefaultGeneralNodeTerminalImageValue() string {
	image := strings.TrimSpace(common.NodeTerminalImage)
	if image == "" {
		return DefaultGeneralNodeTerminalImage
	}
	return image
}

type GeneralSetting struct {
	Model
	AIAgentEnabled     bool         `json:"aiAgentEnabled" gorm:"column:ai_agent_enabled;type:boolean;not null;default:false"`
	AIProvider         string       `json:"aiProvider" gorm:"column:ai_provider;type:varchar(50);not null;default:'openai'"`
	AIModel            string       `json:"aiModel" gorm:"column:ai_model;type:varchar(255);not null;default:'gpt-4o-mini'"`
	AIAPIKey           SecretString `json:"aiApiKey" gorm:"column:ai_api_key;type:text"`
	AIBaseURL          string       `json:"aiBaseUrl" gorm:"column:ai_base_url;type:varchar(500)"`
	AIMaxTokens        int          `json:"aiMaxTokens" gorm:"column:ai_max_tokens;type:integer;default:4096"`
	KubectlEnabled     bool         `json:"kubectlEnabled" gorm:"column:kubectl_enabled;type:boolean;not null;default:true"`
	KubectlImage       string       `json:"kubectlImage" gorm:"column:kubectl_image;type:varchar(255);not null;default:'zzde/kubectl:latest'"`
	NodeTerminalImage  string       `json:"nodeTerminalImage" gorm:"column:node_terminal_image;type:varchar(255);not null;default:'busybox:latest'"`
	EnableAnalytics    bool         `json:"enableAnalytics" gorm:"column:enable_analytics;type:boolean;not null;default:true"`
	EnableVersionCheck bool         `json:"enableVersionCheck" gorm:"column:enable_version_check;type:boolean;not null;default:true"`
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
		if setting.KubectlImage == "" {
			setting.KubectlImage = DefaultGeneralKubectlImage
			updates["kubectl_image"] = DefaultGeneralKubectlImage
		}
		if setting.NodeTerminalImage == "" {
			defaultNodeTerminalImage := DefaultGeneralNodeTerminalImageValue()
			setting.NodeTerminalImage = defaultNodeTerminalImage
			updates["node_terminal_image"] = defaultNodeTerminalImage
		}
		if len(updates) > 0 {
			_ = DB.Model(&setting).Updates(updates).Error
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
		AIMaxTokens:        4096,
		KubectlEnabled:     true,
		KubectlImage:       DefaultGeneralKubectlImage,
		NodeTerminalImage:  DefaultGeneralNodeTerminalImageValue(),
		EnableAnalytics:    common.EnableAnalytics,
		EnableVersionCheck: common.EnableVersionCheck,
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
