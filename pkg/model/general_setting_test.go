package model

import "testing"

func TestNormalizeGeneralAIProvider(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{name: "openai", input: "openai", expected: GeneralAIProviderOpenAI},
		{name: "OpenAI uppercase", input: "OpenAI", expected: GeneralAIProviderOpenAI},
		{name: "anthropic", input: "anthropic", expected: GeneralAIProviderAnthropic},
		{name: "Anthropic uppercase", input: "Anthropic", expected: GeneralAIProviderAnthropic},
		{name: "minimax", input: "minimax", expected: GeneralAIProviderMiniMax},
		{name: "MiniMax mixed case", input: "MiniMax", expected: GeneralAIProviderMiniMax},
		{name: "MINIMAX uppercase", input: "MINIMAX", expected: GeneralAIProviderMiniMax},
		{name: "empty defaults to openai", input: "", expected: GeneralAIProviderOpenAI},
		{name: "unknown defaults to openai", input: "gemini", expected: GeneralAIProviderOpenAI},
		{name: "whitespace trimmed", input: "  minimax  ", expected: GeneralAIProviderMiniMax},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := NormalizeGeneralAIProvider(tc.input)
			if result != tc.expected {
				t.Fatalf("NormalizeGeneralAIProvider(%q) = %q, want %q", tc.input, result, tc.expected)
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
		{name: "MiniMax mixed case", provider: "MiniMax", expected: true},
		{name: "MINIMAX uppercase", provider: "MINIMAX", expected: true},
		{name: "unknown not supported", provider: "unknown", expected: false},
		{name: "empty not supported", provider: "", expected: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := IsGeneralAIProviderSupported(tc.provider)
			if result != tc.expected {
				t.Fatalf("IsGeneralAIProviderSupported(%q) = %v, want %v", tc.provider, result, tc.expected)
			}
		})
	}
}

func TestDefaultGeneralAIModelByProvider(t *testing.T) {
	tests := []struct {
		name     string
		provider string
		expected string
	}{
		{name: "openai default", provider: GeneralAIProviderOpenAI, expected: DefaultGeneralAIModel},
		{name: "anthropic default", provider: GeneralAIProviderAnthropic, expected: DefaultGeneralAnthropicModel},
		{name: "minimax default", provider: GeneralAIProviderMiniMax, expected: DefaultGeneralMiniMaxModel},
		{name: "empty defaults to openai model", provider: "", expected: DefaultGeneralAIModel},
		{name: "unknown defaults to openai model", provider: "gemini", expected: DefaultGeneralAIModel},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := DefaultGeneralAIModelByProvider(tc.provider)
			if result != tc.expected {
				t.Fatalf("DefaultGeneralAIModelByProvider(%q) = %q, want %q", tc.provider, result, tc.expected)
			}
		})
	}
}

func TestMiniMaxProviderConstant(t *testing.T) {
	if GeneralAIProviderMiniMax != "minimax" {
		t.Fatalf("GeneralAIProviderMiniMax = %q, want %q", GeneralAIProviderMiniMax, "minimax")
	}
}

func TestMiniMaxDefaultModel(t *testing.T) {
	if DefaultGeneralMiniMaxModel != "MiniMax-M2.7" {
		t.Fatalf("DefaultGeneralMiniMaxModel = %q, want %q", DefaultGeneralMiniMaxModel, "MiniMax-M2.7")
	}
}
