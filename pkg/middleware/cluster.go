package middleware

import (
	"errors"
	"net/http"
	"net/url"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
)

const (
	ClusterNameHeader = "x-cluster-name"
	ClusterNameKey    = "cluster-name"
)

type clusterClientSetProvider interface {
	GetClientSet(string) (*cluster.ClientSet, error)
}

type idTokenProvider interface {
	IDTokenForRequest(c *gin.Context) (string, error)
}

// ClusterMiddleware selects a cluster from the path, header, or query and injects its clients into context.
// For clusters with OIDC passthrough, the injected client uses the signed-in user's own ID token.
func ClusterMiddleware(cm clusterClientSetProvider, idp idTokenProvider) gin.HandlerFunc {
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
		cs, err = cs.ClientFor(func() (string, error) { return idp.IDTokenForRequest(c) })
		if err != nil {
			switch {
			case errors.Is(err, common.ErrSessionStoreUnavailable):
				c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Session store unavailable, try again"})
			case errors.Is(err, cluster.ErrIDTokenUnavailable):
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Session expired, sign in again"})
			default:
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to build user client"})
			}
			c.Abort()
			return
		}
		c.Set("cluster", cs)
		c.Set(ClusterNameKey, cs.Name)
		c.Next()
	}
}
