package ai

import (
	"fmt"
	"strings"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/zxh326/kite/pkg/model"
)

type RuntimeConfig struct {
	Enabled bool
	Model   string
	APIKey  string
	BaseURL string
}

func LoadRuntimeConfig() (*RuntimeConfig, error) {
	setting, err := model.GetGeneralSetting()
	if err != nil {
		return nil, err
	}

	cfg := &RuntimeConfig{
		Enabled: setting.AIAgentEnabled,
		Model:   strings.TrimSpace(setting.AIModel),
		APIKey:  strings.TrimSpace(string(setting.AIAPIKey)),
		BaseURL: strings.TrimSpace(setting.AIBaseURL),
	}
	if cfg.Model == "" {
		cfg.Model = model.DefaultGeneralAIModel
	}
	if !cfg.Enabled {
		return cfg, nil
	}
	if cfg.APIKey == "" {
		cfg.Enabled = false
	}
	return cfg, nil
}

// NewLLMClient creates an OpenAI-compatible client from runtime configuration.
func NewLLMClient(cfg *RuntimeConfig) (openai.Client, error) {
	if cfg == nil || !cfg.Enabled {
		return openai.Client{}, fmt.Errorf("AI is not enabled")
	}

	opts := make([]option.RequestOption, 0, 2)
	if cfg.APIKey != "" {
		opts = append(opts, option.WithAPIKey(cfg.APIKey))
	}
	if cfg.BaseURL != "" {
		opts = append(opts, option.WithBaseURL(cfg.BaseURL))
	}

	return openai.NewClient(opts...), nil
}
