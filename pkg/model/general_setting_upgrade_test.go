package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/zxh326/kite/pkg/common"
)

// legacyGeneralSetting mirrors the general_settings schema as it existed before
// the ai_effort column was introduced. AutoMigrate is the only migration
// mechanism in this project, so an upgrade is exactly "old table, new struct".
type legacyGeneralSetting struct {
	Model
	AIAgentEnabled    bool   `gorm:"column:ai_agent_enabled;type:boolean;not null;default:false"`
	AIProvider        string `gorm:"column:ai_provider;type:varchar(50);not null;default:'openai'"`
	AIModel           string `gorm:"column:ai_model;type:varchar(255);not null;default:'gpt-4o-mini'"`
	AIMaxTokens       int    `gorm:"column:ai_max_tokens;type:integer;default:4096"`
	KubectlEnabled    bool   `gorm:"column:kubectl_enabled;type:boolean;not null;default:true"`
	KubectlImage      string `gorm:"column:kubectl_image;type:varchar(255);not null;default:'zzde/kubectl:latest'"`
	NodeTerminalImage string `gorm:"column:node_terminal_image;type:varchar(255);not null;default:'busybox:latest'"`
}

func (legacyGeneralSetting) TableName() string { return "general_settings" }

func newUpgradeTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	common.KiteEncryptKey = "general-setting-upgrade-test-key"
	common.JwtSecret = "general-setting-upgrade-test-jwt"

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("opening test database: %v", err)
	}
	return db
}

// TestAutoMigrateAddsAIEffortToExistingInstall is the check I had skipped: that
// AutoMigrate actually adds ai_effort to a pre-existing table, and that a row
// written before the column existed reads back with a usable value rather than
// an empty string that would reach the provider as an invalid effort.
func TestAutoMigrateAddsAIEffortToExistingInstall(t *testing.T) {
	db := newUpgradeTestDB(t)

	// 1. An install running the old schema, with a row already in it.
	if err := db.AutoMigrate(&legacyGeneralSetting{}); err != nil {
		t.Fatalf("migrating legacy schema: %v", err)
	}
	if db.Migrator().HasColumn(&GeneralSetting{}, "ai_effort") {
		t.Fatal("legacy schema unexpectedly already has ai_effort")
	}
	legacy := legacyGeneralSetting{
		Model:             Model{ID: 1},
		AIProvider:        GeneralAIProviderAnthropic,
		AIModel:           DefaultGeneralAnthropicModel,
		AIMaxTokens:       4096,
		KubectlEnabled:    true,
		KubectlImage:      DefaultGeneralKubectlImage,
		NodeTerminalImage: DefaultGeneralNodeTerminalImage,
	}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatalf("seeding legacy row: %v", err)
	}

	// 2. The upgraded binary migrates the same table.
	if err := db.AutoMigrate(&GeneralSetting{}); err != nil {
		t.Fatalf("migrating to current schema: %v", err)
	}
	if !db.Migrator().HasColumn(&GeneralSetting{}, "ai_effort") {
		t.Fatal("ai_effort column was not added by AutoMigrate")
	}

	// 3. The pre-existing row must survive and resolve to a valid effort. GORM
	//    backfills a NOT NULL column with its default, but the value that
	//    actually reaches the provider is whatever GetGeneralSetting returns.
	DB = db
	setting, err := GetGeneralSetting()
	if err != nil {
		t.Fatalf("reading setting after upgrade: %v", err)
	}
	if setting.AIModel != DefaultGeneralAnthropicModel {
		t.Fatalf("upgrade lost the configured model: %q", setting.AIModel)
	}
	if setting.AIEffort != DefaultGeneralAIEffort {
		t.Fatalf("ai_effort after upgrade = %q, want %q", setting.AIEffort, DefaultGeneralAIEffort)
	}

	// 4. The backfill must be persisted, not just applied in memory — otherwise
	//    every read re-runs it and a direct DB consumer still sees the old value.
	var persisted string
	if err := db.Raw("SELECT ai_effort FROM general_settings WHERE id = 1").Scan(&persisted).Error; err != nil {
		t.Fatalf("reading persisted ai_effort: %v", err)
	}
	if persisted != DefaultGeneralAIEffort {
		t.Fatalf("persisted ai_effort = %q, want %q", persisted, DefaultGeneralAIEffort)
	}
}

// TestGetGeneralSettingNormalizesStoredEffort covers a hand-edited or
// downgrade-then-upgrade row carrying a value the SDK would reject.
func TestGetGeneralSettingNormalizesStoredEffort(t *testing.T) {
	db := newUpgradeTestDB(t)
	if err := db.AutoMigrate(&GeneralSetting{}); err != nil {
		t.Fatalf("migrating: %v", err)
	}
	DB = db

	for _, stored := range []string{"", "   ", "extreme", "HIGH"} {
		if err := db.Exec("DELETE FROM general_settings").Error; err != nil {
			t.Fatalf("clearing table: %v", err)
		}
		if err := db.Exec(
			"INSERT INTO general_settings (id, ai_provider, ai_model, ai_effort, kubectl_image, node_terminal_image) VALUES (1, ?, ?, ?, ?, ?)",
			GeneralAIProviderAnthropic, DefaultGeneralAnthropicModel, stored,
			DefaultGeneralKubectlImage, DefaultGeneralNodeTerminalImage,
		).Error; err != nil {
			t.Fatalf("seeding row with effort %q: %v", stored, err)
		}

		setting, err := GetGeneralSetting()
		if err != nil {
			t.Fatalf("reading setting with stored effort %q: %v", stored, err)
		}
		want := NormalizeGeneralAIEffort(stored)
		if setting.AIEffort != want {
			t.Fatalf("stored effort %q resolved to %q, want %q", stored, setting.AIEffort, want)
		}
		// "HIGH" is a valid level in the wrong case: it must normalize to "high",
		// not fall back to the default, or an operator's choice is silently lost.
		if stored == "HIGH" && setting.AIEffort != GeneralAIEffortHigh {
			t.Fatalf("uppercase HIGH resolved to %q, want %q", setting.AIEffort, GeneralAIEffortHigh)
		}
	}
}
