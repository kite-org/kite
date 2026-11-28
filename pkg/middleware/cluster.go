package middleware

import (
	"net/http"
	"net/url"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/model"
)

const (
	ClusterNameHeader = "x-cluster-name"
	ClusterNameKey    = "cluster-name"
)

type clusterClientSetProvider interface {
	GetClientSet(string) (*cluster.ClientSet, error)
}

// ClusterMiddleware selects a cluster from the path, header, or query and injects its clients into context.
func ClusterMiddleware(cm clusterClientSetProvider) gin.HandlerFunc {
	return func(c *gin.Context) {
		clusterName := c.Param("cluster")
		if clusterName == "" {
			clusterName = c.GetHeader(ClusterNameHeader)
			if clusterName != "" {
				if decoded, err := url.PathUnescape(clusterName); err == nil {
					clusterName = decoded
				}
			} else {
				if v, ok := c.GetQuery(ClusterNameHeader); ok {
					clusterName = v
				}
			}
		}
		cs, err := cm.GetClientSet(clusterName)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			c.Abort()
			return
		}
		if cs.ImpersonationEnabled() {
			value, exists := c.Get("user")
			if !exists {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required for impersonation"})
				c.Abort()
				return
			}
			user, ok := value.(model.User)
			if !ok {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid user for impersonation"})
				c.Abort()
				return
			}
			cs, err = cs.ClientFor(user)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				c.Abort()
				return
			}
		}
		c.Set("cluster", cs)
		c.Set(ClusterNameKey, cs.Name)
		c.Next()
	}
}
