package ai

import (
	"testing"

	"github.com/zxh326/kite/pkg/model"
)

func TestNormalizeProvider(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{name: "openai lowercase", input: "openai", expected: model.GeneralAIProviderOpenAI},
		{name: "openai uppercase", input: "OpenAI", expected: model.GeneralAIProviderOpenAI},
		{name: "anthropic lowercase", input: "anthropic", expected: model.GeneralAIProviderAnthropic},
		{name: "anthropic uppercase", input: "Anthropic", expected: model.GeneralAIProviderAnthropic},
		{name: "minimax lowercase", input: "minimax", expected: model.GeneralAIProviderMiniMax},
		{name: "minimax mixed case", input: "MiniMax", expected: model.GeneralAIProviderMiniMax},
		{name: "minimax uppercase", input: "MINIMAX", expected: model.GeneralAIProviderMiniMax},
		{name: "empty defaults to openai", input: "", expected: model.GeneralAIProviderOpenAI},
		{name: "unknown defaults to openai", input: "unknown", expected: model.GeneralAIProviderOpenAI},
		{name: "whitespace trimmed", input: "  minimax  ", expected: model.GeneralAIProviderMiniMax},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := normalizeProvider(tc.input)
			if result != tc.expected {
				t.Fatalf("normalizeProvider(%q) = %q, want %q", tc.input, result, tc.expected)
			}
		})
	}
}

func TestDefaultModelForProvider(t *testing.T) {
	tests := []struct {
		name     string
		provider string
		expected string
	}{
		{name: "openai default model", provider: model.GeneralAIProviderOpenAI, expected: model.DefaultGeneralAIModel},
		{name: "anthropic default model", provider: model.GeneralAIProviderAnthropic, expected: model.DefaultGeneralAnthropicModel},
		{name: "minimax default model", provider: model.GeneralAIProviderMiniMax, expected: model.DefaultGeneralMiniMaxModel},
		{name: "empty defaults to openai model", provider: "", expected: model.DefaultGeneralAIModel},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := defaultModelForProvider(tc.provider)
			if result != tc.expected {
				t.Fatalf("defaultModelForProvider(%q) = %q, want %q", tc.provider, result, tc.expected)
			}
		})
	}
}

func TestProviderLabel(t *testing.T) {
	tests := []struct {
		name     string
		provider string
		expected string
	}{
		{name: "openai label", provider: model.GeneralAIProviderOpenAI, expected: "OpenAI"},
		{name: "anthropic label", provider: model.GeneralAIProviderAnthropic, expected: "Anthropic"},
		{name: "minimax label", provider: model.GeneralAIProviderMiniMax, expected: "MiniMax"},
		{name: "unknown defaults to openai", provider: "unknown", expected: "OpenAI"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := providerLabel(tc.provider)
			if result != tc.expected {
				t.Fatalf("providerLabel(%q) = %q, want %q", tc.provider, result, tc.expected)
			}
		})
	}
}

func TestIsGeneralAIProviderSupported(t *testing.T) {
	tests := []struct {
		name     string
		provider string
		expected bool
	}{
		{name: "openai supported", provider: "openai", expected: true},
		{name: "anthropic supported", provider: "anthropic", expected: true},
		{name: "minimax supported", provider: "minimax", expected: true},
		{name: "MiniMax mixed case supported", provider: "MiniMax", expected: true},
		{name: "unknown not supported", provider: "unknown", expected: false},
		{name: "empty not supported", provider: "", expected: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := model.IsGeneralAIProviderSupported(tc.provider)
			if result != tc.expected {
				t.Fatalf("IsGeneralAIProviderSupported(%q) = %v, want %v", tc.provider, result, tc.expected)
			}
		})
	}
}

func TestNewOpenAIClientRejectsWrongProvider(t *testing.T) {
	cfg := &RuntimeConfig{
		Enabled:  true,
		Provider: model.GeneralAIProviderMiniMax,
		APIKey:   "test-key",
	}
	_, err := NewOpenAIClient(cfg)
	if err == nil {
		t.Fatal("expected error when creating OpenAI client with MiniMax provider")
	}
}

func TestNewMiniMaxClientRejectsWrongProvider(t *testing.T) {
	cfg := &RuntimeConfig{
		Enabled:  true,
		Provider: model.GeneralAIProviderOpenAI,
		APIKey:   "test-key",
	}
	_, err := NewMiniMaxClient(cfg)
	if err == nil {
		t.Fatal("expected error when creating MiniMax client with OpenAI provider")
	}
}

func TestNewMiniMaxClientDisabled(t *testing.T) {
	cfg := &RuntimeConfig{
		Enabled:  false,
		Provider: model.GeneralAIProviderMiniMax,
		APIKey:   "test-key",
	}
	_, err := NewMiniMaxClient(cfg)
	if err == nil {
		t.Fatal("expected error when AI is disabled")
	}
}

func TestNewMiniMaxClientNilConfig(t *testing.T) {
	_, err := NewMiniMaxClient(nil)
	if err == nil {
		t.Fatal("expected error with nil config")
	}
}

func TestNewMiniMaxClientSuccess(t *testing.T) {
	cfg := &RuntimeConfig{
		Enabled:  true,
		Provider: model.GeneralAIProviderMiniMax,
		APIKey:   "test-minimax-key",
	}
	_, err := NewMiniMaxClient(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestNewMiniMaxClientCustomBaseURL(t *testing.T) {
	cfg := &RuntimeConfig{
		Enabled:  true,
		Provider: model.GeneralAIProviderMiniMax,
		APIKey:   "test-minimax-key",
		BaseURL:  "https://custom.minimax.example.com/v1",
	}
	_, err := NewMiniMaxClient(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestNewAnthropicClientRejectsMiniMax(t *testing.T) {
	cfg := &RuntimeConfig{
		Enabled:  true,
		Provider: model.GeneralAIProviderMiniMax,
		APIKey:   "test-key",
	}
	_, err := NewAnthropicClient(cfg)
	if err == nil {
		t.Fatal("expected error when creating Anthropic client with MiniMax provider")
	}
}
