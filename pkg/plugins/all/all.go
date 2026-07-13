// Package all collects every plugin's blank import so that routes.go only
// needs to import this single package.
package all

import (
	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/plugins"

	_ "github.com/zxh326/kite/pkg/plugins/gpu"
)

func RegisterRoutes(api *gin.RouterGroup) {
	plugins.RegisterRoutes(api)
}
