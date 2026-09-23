package telemetry

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"time"

	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/version"
)

const endpoint = "https://telemetry.kitehq.dev/telemetry"

type pluginInfo struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Enabled bool   `json:"enabled"`
}

type telemetryReport struct {
	InstallationID     string       `json:"installationId"`
	KiteVersion        string       `json:"kiteVersion"`
	KubernetesVersions []string     `json:"kubernetesVersions"`
	Plugins            []pluginInfo `json:"plugins"`
	OS                 string       `json:"os"`
	Arch               string       `json:"arch"`
}

func Start(ctx context.Context, cm *cluster.ClusterManager) {
	go func() {
		for {
			_ = reportIfDue(ctx, cm)
			time.Sleep(1 * time.Hour)
		}
	}()
}

func reportIfDue(ctx context.Context, cm *cluster.ClusterManager) error {
	db := model.DB.WithContext(ctx)
	var setting model.GeneralSetting
	if err := db.Select("id", "enable_analytics", "analytics_installation_id", "analytics_last_attempt_at").First(&setting, 1).Error; err != nil {
		return err
	}
	if !setting.EnableAnalytics {
		return nil
	}

	now := time.Now().UTC()
	cutoff := now.Add(-24 * time.Hour)
	if setting.AnalyticsLastAttemptAt != nil && setting.AnalyticsLastAttemptAt.After(cutoff) {
		return nil
	}
	if setting.AnalyticsInstallationID == "" {
		var id [16]byte
		if _, err := rand.Read(id[:]); err != nil {
			return err
		}
		setting.AnalyticsInstallationID = hex.EncodeToString(id[:])
	}
	claimed := db.Model(&model.GeneralSetting{}).
		Where("id = ? AND enable_analytics = ? AND (analytics_last_attempt_at IS NULL OR analytics_last_attempt_at <= ?)", setting.ID, true, cutoff).
		Updates(map[string]interface{}{
			"analytics_installation_id": setting.AnalyticsInstallationID,
			"analytics_last_attempt_at": now,
		})
	if claimed.Error != nil {
		return claimed.Error
	}
	if claimed.RowsAffected == 0 {
		return nil
	}

	var clusterNames []string
	if err := db.Model(&model.Cluster{}).Where("enable = ?", true).Pluck("name", &clusterNames).Error; err != nil {
		return err
	}
	versions := make([]string, 0, len(clusterNames))
	for _, name := range clusterNames {
		client, err := cm.GetClientSet(name)
		if err == nil {
			versions = append(versions, client.Version)
		}
	}
	plugins := make([]pluginInfo, 0)
	if err := db.Model(&model.Plugin{}).Select("id", "version", "enabled").Order("id").Find(&plugins).Error; err != nil {
		return err
	}
	body, err := json.Marshal(telemetryReport{
		InstallationID:     setting.AnalyticsInstallationID,
		KiteVersion:        version.Version,
		KubernetesVersions: versions,
		Plugins:            plugins,
		OS:                 runtime.GOOS,
		Arch:               runtime.GOARCH,
	})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "Kite/"+version.Version)
	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("collector returned HTTP %d", response.StatusCode)
	}
	return nil
}
