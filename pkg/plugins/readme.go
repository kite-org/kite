package plugins

import (
	"bytes"
	"context"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/model"
)

func GetCatalogReadme(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	var request struct {
		ID      string `form:"id" binding:"required"`
		Version string `form:"version" binding:"required"`
	}
	if err := c.ShouldBindQuery(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "plugin id and version are required"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	setting, err := model.GetGeneralSetting()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	catalog, err := readCatalog(ctx, setting.PluginCatalogURL)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	var plugin *CatalogPlugin
	for i := range catalog {
		if catalog[i].ID == request.ID && catalog[i].Version == request.Version {
			plugin = &catalog[i]
			break
		}
	}
	if plugin == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "plugin version was not found in the catalog"})
		return
	}
	if plugin.ReadmeURL == "" {
		c.JSON(http.StatusOK, gin.H{"readme": "", "baseUrl": ""})
		return
	}
	resp, err := fetch(ctx, plugin.ReadmeURL)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to fetch plugin README: " + err.Error()})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	if contentType := resp.Header.Get("Content-Type"); contentType != "" {
		mediaType, _, err := mime.ParseMediaType(contentType)
		if err != nil || mediaType == "text/html" || (!strings.HasPrefix(mediaType, "text/") && mediaType != "application/octet-stream" && mediaType != "application/markdown") {
			c.JSON(http.StatusBadGateway, gin.H{"error": "plugin README must contain Markdown or plain text"})
			return
		}
	}
	const maxReadmeSize = 1024 * 1024
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxReadmeSize+1))
	if err != nil || len(data) > maxReadmeSize {
		c.JSON(http.StatusBadGateway, gin.H{"error": "plugin README could not be read or exceeds 1 MiB"})
		return
	}
	if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "plugin README must be UTF-8 text"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"readme": string(data), "baseUrl": resp.Request.URL.String()})
}
