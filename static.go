package main

import (
	"embed"
	"io/fs"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/middleware"
	"github.com/zxh326/kite/pkg/utils"
)

//go:embed static
var staticFiles embed.FS

func setupStatic(r *gin.Engine) {
	base := common.Base
	if base != "" && base != "/" {
		r.GET("/", func(c *gin.Context) {
			c.Redirect(http.StatusFound, base+"/")
		})
	}

	assetsFS, err := fs.Sub(staticFiles, "static/assets")
	if err != nil {
		panic(err)
	}

	assetsGroup := r.Group(base + "/assets")
	assetsGroup.Use(middleware.StaticCache())
	assetsGroup.StaticFS("/", http.FS(assetsFS))

	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if len(path) >= len(base)+5 && path[len(base):len(base)+5] == "/api/" {
			c.JSON(http.StatusNotFound, gin.H{"error": "API endpoint not found"})
			return
		}

		content, err := staticFiles.ReadFile("static/index.html")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read index.html"})
			return
		}

		htmlContent := utils.InjectKiteBase(string(content), base)
		if common.EnableAnalytics {
			htmlContent = utils.InjectAnalytics(htmlContent)
		}

		c.Header("Content-Type", "text/html; charset=utf-8")
		c.String(http.StatusOK, htmlContent)
	})
}
