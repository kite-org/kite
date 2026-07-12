package middleware

import (
	"net/url"

	"github.com/gin-gonic/gin"
)

// ConfigureRawPathRouting keeps escaped slashes inside one route parameter and decodes parameters once with path semantics.
func ConfigureRawPathRouting(r *gin.Engine) {
	r.UseRawPath = true
	r.UnescapePathValues = false
	r.Use(func(c *gin.Context) {
		if c.Request.URL.RawPath != "" {
			for i := range c.Params {
				if decoded, err := url.PathUnescape(c.Params[i].Value); err == nil {
					c.Params[i].Value = decoded
				}
			}
		}
	})
}
