package plugins

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"gorm.io/gorm"
	"k8s.io/klog/v2"
)

type InstalledPlugin struct {
	ID       string    `json:"id"`
	Enabled  bool      `json:"enabled"`
	Version  string    `json:"version"`
	Manifest *Manifest `json:"manifest,omitempty"`
	Error    string    `json:"error,omitempty"`
}

func assetBaseURL(plugin model.Plugin) string {
	return fmt.Sprintf("%s/plugin-assets/%s/%s/%s/", common.Base, plugin.ID, plugin.Version, plugin.Digest)
}

func ListActive(c *gin.Context) {
	records, err := enabledPlugins()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	type activePlugin struct {
		Manifest     *Manifest `json:"manifest"`
		AssetBaseURL string    `json:"assetBaseUrl"`
		Error        string    `json:"error,omitempty"`
	}
	plugins := make([]activePlugin, 0, len(records))
	for _, record := range records {
		manifest, err := loadInstalledPlugin(record, true)
		if manifest == nil {
			continue
		}
		plugin := activePlugin{Manifest: manifest, AssetBaseURL: assetBaseURL(record)}
		if err != nil {
			plugin.Error = err.Error()
		}
		plugins = append(plugins, plugin)
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"plugins": plugins, "devUrl": common.PluginDevURL})
}

func describeInstalledPlugin(record model.Plugin) InstalledPlugin {
	manifest, err := loadInstalledPlugin(record, record.Enabled)
	plugin := InstalledPlugin{ID: record.ID, Enabled: record.Enabled, Version: record.Version, Manifest: manifest}
	if err != nil {
		plugin.Error = err.Error()
	}
	return plugin
}

func ListInstalled(c *gin.Context) {
	var records []model.Plugin
	if err := model.DB.Order("id").Find(&records).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	plugins := make([]InstalledPlugin, 0, len(records))
	for _, record := range records {
		plugins = append(plugins, describeInstalledPlugin(record))
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"plugins": plugins})
}

func ListCatalog(c *gin.Context) {
	setting, err := model.GetGeneralSetting()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	plugins, err := readCatalog(c.Request.Context(), setting.PluginCatalogURL)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"plugins": plugins})
}

func Install(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxArchiveSize+1024*1024)
	var id string
	var err error
	if strings.HasPrefix(c.ContentType(), "multipart/form-data") {
		id, err = installUpload(c)
	} else {
		id, err = installFromCatalog(c)
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	recordAudit(c, id, "install")
	respondInstalled(c, id, http.StatusCreated)
}

func installUpload(c *gin.Context) (string, error) {
	file, err := c.FormFile("file")
	if c.Request.MultipartForm != nil {
		defer func() { _ = c.Request.MultipartForm.RemoveAll() }()
	}
	if err != nil {
		return "", fmt.Errorf("a tar.gz file is required (maximum 50 MiB)")
	}
	enabled, err := strconv.ParseBool(c.DefaultPostForm("enabled", "true"))
	if err != nil {
		return "", fmt.Errorf("enabled must be a boolean")
	}
	reader, err := file.Open()
	if err != nil {
		return "", err
	}
	defer func() { _ = reader.Close() }()
	return installArchive(reader, nil, enabled)
}

func installFromCatalog(c *gin.Context) (string, error) {
	request := struct {
		ID      string `json:"id" binding:"required"`
		Version string `json:"version" binding:"required"`
		Enabled bool   `json:"enabled"`
	}{Enabled: true}
	if err := c.ShouldBindJSON(&request); err != nil {
		return "", fmt.Errorf("invalid catalog installation request: %w", err)
	}
	setting, err := model.GetGeneralSetting()
	if err != nil {
		return "", err
	}
	catalog, err := readCatalog(c.Request.Context(), setting.PluginCatalogURL)
	if err != nil {
		return "", err
	}
	for _, plugin := range catalog {
		if plugin.ID != request.ID || plugin.Version != request.Version {
			continue
		}
		if plugin.Error != "" {
			return "", fmt.Errorf("%s", plugin.Error)
		}
		resp, err := fetch(c.Request.Context(), plugin.URL)
		if err != nil {
			return "", err
		}
		defer func() { _ = resp.Body.Close() }()
		return installArchive(resp.Body, &plugin, request.Enabled)
	}
	return "", fmt.Errorf("plugin version was not found in the catalog")
}

func Update(c *gin.Context) {
	var request struct {
		Enabled *bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&request); err != nil || request.Enabled == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "enabled is required"})
		return
	}
	id := c.Param("id")
	mutationMu.Lock()
	var plugin model.Plugin
	err := model.DB.First(&plugin, "id = ?", id).Error
	if err == nil {
		err = model.DB.Model(&plugin).Update("enabled", *request.Enabled).Error
	}
	if err == nil {
		forgetRecovery(id)
	}
	mutationMu.Unlock()
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, gorm.ErrRecordNotFound) {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	recordAudit(c, id, "update")
	respondInstalled(c, id, http.StatusOK)
}

func respondInstalled(c *gin.Context, id string, status int) {
	var record model.Plugin
	if err := model.DB.First(&record, "id = ?", id).Error; err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, gorm.ErrRecordNotFound) {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(status, describeInstalledPlugin(record))
}

func Delete(c *gin.Context) {
	id := c.Param("id")
	mutationMu.Lock()
	defer mutationMu.Unlock()
	result := model.DB.Where("id = ?", id).Delete(&model.Plugin{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": gorm.ErrRecordNotFound.Error()})
		return
	}
	forgetRecovery(id)
	if err := os.RemoveAll(filepath.Join(common.PluginDir, id)); err != nil {
		klog.Errorf("Failed to remove uninstalled plugin assets: %v", err)
	}
	if err := model.DeletePluginSetting(id); err != nil {
		klog.Errorf("Failed to remove uninstalled plugin settings: %v", err)
	}

	recordAudit(c, id, "delete")
	c.JSON(http.StatusOK, gin.H{"message": "Plugin uninstalled"})
}

func ServeAsset(c *gin.Context) {
	id, version, digest := c.Param("id"), c.Param("version"), c.Param("digest")
	name := strings.TrimPrefix(c.Param("path"), "/")
	if !validPluginID(id) || !validAssetPath(version) || !validAssetPath(digest) || !validAssetPath(name) {
		c.Status(http.StatusNotFound)
		return
	}
	var record model.Plugin
	if err := model.DB.First(&record, "id = ? AND version = ? AND digest = ?", id, version, digest).Error; err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	filename := filepath.Join(common.PluginDir, id, version, digest, filepath.FromSlash(name))
	info, err := os.Stat(filename)
	if err != nil || !info.Mode().IsRegular() {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Header("X-Content-Type-Options", "nosniff")
	c.File(filename)
}

func recordAudit(c *gin.Context, id, operation string) {
	user := c.MustGet("user").(model.User)
	history := model.ResourceHistory{
		ResourceType: "plugins", ResourceName: id, OperationType: operation,
		OperationSource: "manual", OperatorID: user.ID, Success: true,
	}
	if err := model.DB.Create(&history).Error; err != nil {
		klog.Errorf("Failed to record plugin management audit: %v", err)
	}
}
