package ai

import (
	"fmt"
	"strings"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	anthropicoption "github.com/anthropics/anthropic-sdk-go/option"
	"github.com/openai/openai-go"
	openaioption "github.com/openai/openai-go/option"
	"github.com/zxh326/kite/pkg/model"
)

type RuntimeConfig struct {
	Enabled   bool
	Provider  string
	Model     string
	APIKey    string
	BaseURL   string
	MaxTokens int
}

func normalizeProvider(provider string) string {
	return model.NormalizeGeneralAIProvider(strings.ToLower(strings.TrimSpace(provider)))
}

func defaultModelForProvider(provider string) string {
	return model.DefaultGeneralAIModelByProvider(provider)
}

func isOpenRouterBaseURL(baseURL string) bool {
	return strings.Contains(strings.ToLower(strings.TrimSpace(baseURL)), "openrouter.ai")
}

func providerLabel(provider string) string {
	switch provider {
	case model.GeneralAIProviderAnthropic:
		return "Anthropic"
	default:
		return "OpenAI"
	}
}

func LoadRuntimeConfig() (*RuntimeConfig, error) {
	setting, err := model.GetGeneralSetting()
	if err != nil {
		return nil, err
	}

	cfg := &RuntimeConfig{
		Enabled:   setting.AIAgentEnabled,
		Provider:  normalizeProvider(setting.AIProvider),
		Model:     strings.TrimSpace(setting.AIModel),
		APIKey:    strings.TrimSpace(string(setting.AIAPIKey)),
		BaseURL:   strings.TrimSpace(setting.AIBaseURL),
		MaxTokens: setting.AIMaxTokens,
	}
	if cfg.Model == "" {
		cfg.Model = defaultModelForProvider(cfg.Provider)
	}
	if cfg.MaxTokens <= 0 {
		cfg.MaxTokens = 4096
	}
	if !cfg.Enabled {
		return cfg, nil
	}
	if cfg.APIKey == "" {
		cfg.Enabled = false
	}
	return cfg, nil
}

func NewOpenAIClient(cfg *RuntimeConfig) (openai.Client, error) {
	if cfg == nil || !cfg.Enabled {
		return openai.Client{}, fmt.Errorf("AI is not enabled")
	}
	if normalizeProvider(cfg.Provider) != model.GeneralAIProviderOpenAI {
		return openai.Client{}, fmt.Errorf("AI provider %s is not supported by OpenAI client", providerLabel(cfg.Provider))
	}

	opts := make([]openaioption.RequestOption, 0, 2)
	if cfg.APIKey != "" {
		opts = append(opts, openaioption.WithAPIKey(cfg.APIKey))
	}
	if cfg.BaseURL != "" {
		opts = append(opts, openaioption.WithBaseURL(cfg.BaseURL))
		if isOpenRouterBaseURL(cfg.BaseURL) {
			opts = append(opts, openaioption.WithHeader("X-OpenRouter-Title", "OpenClaw"))
		}
	}

	return openai.NewClient(opts...), nil
}

func NewAnthropicClient(cfg *RuntimeConfig) (anthropic.Client, error) {
	if cfg == nil || !cfg.Enabled {
		return anthropic.Client{}, fmt.Errorf("AI is not enabled")
	}
	if normalizeProvider(cfg.Provider) != model.GeneralAIProviderAnthropic {
		return anthropic.Client{}, fmt.Errorf("AI provider %s is not supported by Anthropic client", providerLabel(cfg.Provider))
	}

	opts := make([]anthropicoption.RequestOption, 0, 2)
	if cfg.APIKey != "" {
		opts = append(opts, anthropicoption.WithAuthToken(cfg.APIKey))
		opts = append(opts, anthropicoption.WithAPIKey(cfg.APIKey))
	}
	if cfg.BaseURL != "" {
		opts = append(opts, anthropicoption.WithBaseURL(cfg.BaseURL))
		if isOpenRouterBaseURL(cfg.BaseURL) {
			opts = append(opts, anthropicoption.WithHeader("X-OpenRouter-Title", "OpenClaw"))
		}
	}

	return anthropic.NewClient(opts...), nil
}
