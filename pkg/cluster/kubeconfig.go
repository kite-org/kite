package cluster

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"github.com/zxh326/kite/pkg/statefultoken"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

const (
	minKubeconfigTTL = int64(3600)
	maxKubeconfigTTL = int64(157680000)
)

type kubeconfigRequest struct {
	ClusterUUIDs []string `json:"clusterUUIDs" binding:"required"`
	TTLSeconds   int64    `json:"ttlSeconds" binding:"required"`
}

func sanitizeKubeconfigName(name string) string {
	return strings.NewReplacer("/", "-", "\\", "-", ":", "-", " ", "-").Replace(name)
}

func (cm *ClusterManager) DownloadKubeconfig(c *gin.Context) {
	var req kubeconfigRequest
	if err := c.ShouldBindJSON(&req); err != nil || len(req.ClusterUUIDs) == 0 || req.TTLSeconds < minKubeconfigTTL || req.TTLSeconds > maxKubeconfigTTL {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ttlSeconds must be an integer between 3600 and 157680000"})
		return
	}
	user := c.MustGet("user").(model.User)
	clusters := make([]*model.Cluster, 0, len(req.ClusterUUIDs))
	seen := make(map[string]struct{}, len(req.ClusterUUIDs))
	for _, clusterUUID := range req.ClusterUUIDs {
		if _, err := uuid.Parse(clusterUUID); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cluster UUID"})
			return
		}
		if _, ok := seen[clusterUUID]; ok {
			continue
		}
		seen[clusterUUID] = struct{}{}
		cluster, err := model.GetClusterByUUID(clusterUUID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
			return
		}
		if !cluster.Enable {
			c.JSON(http.StatusConflict, gin.H{"error": "cluster is disabled"})
			return
		}
		if !rbac.CanAccessClusterCurrent(user, cluster.Name) {
			c.JSON(http.StatusForbidden, gin.H{"error": "access denied to cluster"})
			return
		}
		clusters = append(clusters, cluster)
	}

	now := time.Now().UTC()
	expiresAt := now.Add(time.Duration(req.TTLSeconds) * time.Second)
	name := fmt.Sprintf("kubeconfig-%s-%s", sanitizeKubeconfigName(user.Key()), now.Format("20060102150405.000"))
	service, err := newKubeconfigTokenService()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "kubeconfig token signing is unavailable"})
		return
	}
	issued, err := service.Issue(c.Request.Context(), statefultoken.IssueRequest{
		SubjectID: strconv.FormatUint(uint64(user.ID), 10), Name: name, ExpiresAt: expiresAt,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create kubeconfig token"})
		return
	}
	config := clientcmdapi.NewConfig()
	serverURL := clusterAgentServerURL(c)
	entryNames := make(map[string]string, len(clusters))
	usedNames := make(map[string]struct{}, len(clusters))
	for _, cluster := range clusters {
		baseName := sanitizeKubeconfigName(cluster.Name)
		entryName := baseName
		for suffix := 2; ; suffix++ {
			if _, exists := usedNames[entryName]; !exists {
				break
			}
			entryName = fmt.Sprintf("%s-%d", baseName, suffix)
		}
		usedNames[entryName] = struct{}{}
		entryNames[cluster.UUID] = entryName
		config.Clusters[entryName] = &clientcmdapi.Cluster{Server: fmt.Sprintf("%s/api/v1/clusters/%s/k8s-proxy", strings.TrimRight(serverURL, "/"), cluster.UUID)}
		config.Contexts[entryName] = &clientcmdapi.Context{Cluster: entryName, AuthInfo: "kite-kubeconfig", Namespace: "default"}
	}
	config.AuthInfos["kite-kubeconfig"] = &clientcmdapi.AuthInfo{Token: issued.Encoded}
	currentCluster := c.GetHeader("X-Cluster-Name")
	for _, cluster := range clusters {
		if cluster.Name == currentCluster {
			config.CurrentContext = entryNames[cluster.UUID]
			break
		}
	}
	if config.CurrentContext == "" {
		config.CurrentContext = entryNames[clusters[0].UUID]
	}
	content, err := clientcmd.Write(*config)
	if err != nil {
		_ = service.Discard(c.Request.Context(), issued.Record.ID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate kubeconfig"})
		return
	}
	c.Header("Content-Disposition", `attachment; filename="kite-kubeconfig.yaml"`)
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Data(http.StatusOK, "application/yaml", content)
}
