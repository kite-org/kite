package model

import (
	"testing"

	"github.com/zxh326/kite/pkg/common"
)

func TestDefaultGeneralNodeTerminalImageValue(t *testing.T) {
	original := common.NodeTerminalImage
	t.Cleanup(func() {
		common.NodeTerminalImage = original
	})

	common.NodeTerminalImage = "  custom/node-terminal:1.0  "
	if got := DefaultGeneralNodeTerminalImageValue(); got != "custom/node-terminal:1.0" {
		t.Fatalf("DefaultGeneralNodeTerminalImageValue() = %q, want %q", got, "custom/node-terminal:1.0")
	}

	common.NodeTerminalImage = "   "
	if got := DefaultGeneralNodeTerminalImageValue(); got != DefaultGeneralNodeTerminalImage {
		t.Fatalf("DefaultGeneralNodeTerminalImageValue() = %q, want %q", got, DefaultGeneralNodeTerminalImage)
	}
}

func TestNormalizeGeneralAIProvider(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"anthropic", " Anthropic ", GeneralAIProviderAnthropic},
		{"openai", "OPENAI", GeneralAIProviderOpenAI},
		{"unknown", "something-else", GeneralAIProviderOpenAI},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NormalizeGeneralAIProvider(tt.input); got != tt.expected {
				t.Fatalf("NormalizeGeneralAIProvider() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestIsGeneralAIProviderSupported(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{"openai", "openai", true},
		{"anthropic", " Anthropic ", true},
		{"unknown", "gemini", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsGeneralAIProviderSupported(tt.input); got != tt.want {
				t.Fatalf("IsGeneralAIProviderSupported() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestDefaultGeneralAIModelByProvider(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"anthropic", GeneralAIProviderAnthropic, "claude-sonnet-5-5"},
		{"openai", GeneralAIProviderOpenAI, DefaultGeneralAIModel},
		{"unknown", "anything else", DefaultGeneralAIModel},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := DefaultGeneralAIModelByProvider(tt.input); got != tt.expected {
				t.Fatalf("DefaultGeneralAIModelByProvider() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestApplyRuntimeGeneralSetting(t *testing.T) {
	originalAnalytics := common.EnableAnalytics
	originalVersionCheck := common.EnableVersionCheck
	t.Cleanup(func() {
		common.EnableAnalytics = originalAnalytics
		common.EnableVersionCheck = originalVersionCheck
	})

	applyRuntimeGeneralSetting(&GeneralSetting{
		EnableAnalytics:    true,
		EnableVersionCheck: false,
	})

	if !common.EnableAnalytics {
		t.Fatalf("EnableAnalytics = %v, want true", common.EnableAnalytics)
	}
	if common.EnableVersionCheck {
		t.Fatalf("EnableVersionCheck = %v, want false", common.EnableVersionCheck)
	}

	applyRuntimeGeneralSetting(nil)
	if !common.EnableAnalytics {
		t.Fatalf("nil setting changed EnableAnalytics")
	}
	if common.EnableVersionCheck {
		t.Fatalf("nil setting changed EnableVersionCheck")
	}
}

func TestEnsureJWTSecret(t *testing.T) {
	originalJWTSecret := common.JwtSecret
	t.Cleanup(func() {
		common.JwtSecret = originalJWTSecret
	})

	t.Run("configured secret wins", func(t *testing.T) {
		common.JwtSecret = "configured-secret"
		setting := GeneralSetting{JWTSecret: SecretString("stored-secret")}
		updates := map[string]interface{}{}

		if err := ensureJWTSecret(&setting, updates); err != nil {
			t.Fatalf("ensureJWTSecret() error = %v", err)
		}
		if setting.JWTSecret != SecretString("configured-secret") {
			t.Fatalf("setting.JWTSecret = %q, want %q", setting.JWTSecret, "configured-secret")
		}
		if common.JwtSecret != "configured-secret" {
			t.Fatalf("common.JwtSecret = %q, want %q", common.JwtSecret, "configured-secret")
		}
		if got := updates["jwt_secret"]; got != SecretString("configured-secret") {
			t.Fatalf("updates[jwt_secret] = %#v, want %#v", got, SecretString("configured-secret"))
		}
	})

	t.Run("stored secret is reused when config uses default", func(t *testing.T) {
		common.JwtSecret = common.DefaultJWTSecret
		setting := GeneralSetting{JWTSecret: SecretString("stored-secret")}

		if err := ensureJWTSecret(&setting, nil); err != nil {
			t.Fatalf("ensureJWTSecret() error = %v", err)
		}
		if setting.JWTSecret != SecretString("stored-secret") {
			t.Fatalf("setting.JWTSecret = %q, want %q", setting.JWTSecret, "stored-secret")
		}
		if common.JwtSecret != "stored-secret" {
			t.Fatalf("common.JwtSecret = %q, want %q", common.JwtSecret, "stored-secret")
		}
	})

	t.Run("generates secret when neither source is set", func(t *testing.T) {
		common.JwtSecret = common.DefaultJWTSecret
		setting := GeneralSetting{}
		updates := map[string]interface{}{}

		if err := ensureJWTSecret(&setting, updates); err != nil {
			t.Fatalf("ensureJWTSecret() error = %v", err)
		}
		if setting.JWTSecret == "" {
			t.Fatal("setting.JWTSecret is empty")
		}
		if setting.JWTSecret == SecretString(common.DefaultJWTSecret) {
			t.Fatalf("setting.JWTSecret = %q, want generated secret", setting.JWTSecret)
		}
		if common.JwtSecret != string(setting.JWTSecret) {
			t.Fatalf("common.JwtSecret = %q, want %q", common.JwtSecret, setting.JWTSecret)
		}
		if got := updates["jwt_secret"]; got != setting.JWTSecret {
			t.Fatalf("updates[jwt_secret] = %#v, want %#v", got, setting.JWTSecret)
		}
	})
}
