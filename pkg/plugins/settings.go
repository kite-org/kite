package plugins

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/model"
)

const maxPluginSettingSize = 16 * 1024

func GetSetting(c *gin.Context) {
	id := c.Param("id")
	if !validPluginID(id) || !pluginInstalled(id) {
		c.JSON(http.StatusNotFound, gin.H{"error": "plugin is not installed"})
		return
	}
	data, err := model.GetPluginSetting(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, "application/json", []byte(settingsResponse(data)))
}

func UpdateSetting(c *gin.Context) {
	id := c.Param("id")
	if !validPluginID(id) || !pluginInstalled(id) {
		c.JSON(http.StatusNotFound, gin.H{"error": "plugin is not installed"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxPluginSettingSize+1)
	var settings map[string]any
	if err := c.ShouldBindJSON(&settings); err != nil || settings == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("settings must be a JSON object of at most %d KiB", maxPluginSettingSize/1024)})
		return
	}
	data, err := json.Marshal(settings)
	if err != nil || len(data) > maxPluginSettingSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("settings must be a JSON object of at most %d KiB", maxPluginSettingSize/1024)})
		return
	}
	if err := model.SavePluginSetting(id, string(data)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, settings)
}

func pluginInstalled(id string) bool {
	return model.DB.First(&model.Plugin{}, "id = ?", id).Error == nil
}

func settingsResponse(data string) string {
	if data == "" {
		return "{}"
	}
	return data
}
