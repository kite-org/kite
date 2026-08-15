package cluster

import (
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/clusteragent"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"gorm.io/gorm"
	"k8s.io/client-go/tools/clientcmd"
)

// clusterAgentServerURL derives the Kite server URL from the request context,
// using common.Host / X-Forwarded-Host / request host and common.Base.
func clusterAgentServerURL(c *gin.Context) string {
	scheme := "http"
	if c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	host := strings.TrimSpace(common.Host)
	if host == "" {
		host = strings.TrimSpace(c.GetHeader("X-Forwarded-Host"))
		if host == "" {
			host = c.Request.Host
		}
	}
	if !strings.HasPrefix(host, "http://") && !strings.HasPrefix(host, "https://") {
		host = scheme + "://" + host
	}
	return fmt.Sprintf("%s%s", strings.TrimRight(host, "/"), common.Base)
}

func (cm *ClusterManager) GetClusters(c *gin.Context) {
	clusters, errors, defaultContext := cm.snapshotState()
	result := make([]common.ClusterInfo, 0, len(clusters))
	user := c.MustGet("user").(model.User)
	for name, cluster := range clusters {
		if !rbac.CanAccessCluster(user, name) {
			continue
		}
		result = append(result, common.ClusterInfo{
			Name:      name,
			Version:   cluster.Version,
			IsDefault: name == defaultContext,
		})
	}
	for name, errMsg := range errors {
		if !rbac.CanAccessCluster(user, name) {
			continue
		}
		result = append(result, common.ClusterInfo{
			Name:      name,
			Version:   "",
			IsDefault: false,
			Error:     errMsg,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Name < result[j].Name
	})
	c.JSON(http.StatusOK, result)
}

func (cm *ClusterManager) GetClusterList(c *gin.Context) {
	clusters, err := model.ListClusters()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	clusterState, errorState, _ := cm.snapshotState()
	result := make([]gin.H, 0, len(clusters))
	for _, cluster := range clusters {
		clusterInfo := gin.H{
			"id":            cluster.ID,
			"name":          cluster.Name,
			"description":   cluster.Description,
			"enabled":       cluster.Enable,
			"inCluster":     cluster.InCluster,
			"clusterAgent":  cluster.ClusterAgent,
			"connected":     cluster.ClusterAgent && cm.clusterAgentManager.Connected(cluster.ID),
			"isDefault":     cluster.IsDefault,
			"prometheusURL": cluster.PrometheusURL,
			"config":        "",
		}

		if clientSet, exists := clusterState[cluster.Name]; exists {
			clusterInfo["version"] = clientSet.Version
		}
		if errMsg, exists := errorState[cluster.Name]; exists {
			clusterInfo["error"] = errMsg
		}

		result = append(result, clusterInfo)
	}

	c.JSON(http.StatusOK, result)
}

func (cm *ClusterManager) CreateCluster(c *gin.Context) {
	if common.IsSectionManaged("clusters") {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
		return
	}

	var req struct {
		Name          string `json:"name" binding:"required"`
		Description   string `json:"description"`
		Config        string `json:"config"`
		PrometheusURL string `json:"prometheusURL"`
		InCluster     bool   `json:"inCluster"`
		ClusterAgent  bool   `json:"clusterAgent"`
		IsDefault     bool   `json:"isDefault"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.ClusterAgent {
		req.InCluster = false
		req.Config = ""
	}

	if _, err := model.GetClusterByName(req.Name); err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "cluster already exists"})
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if req.IsDefault {
		if err := model.ClearDefaultCluster(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	var clusterAgentToken string
	var clusterAgentTokenHash string
	var clusterAgentPublicKey string
	var clusterAgentPrivateKey string
	var clusterAgentManifestGrant string
	if req.ClusterAgent {
		var err error
		clusterAgentToken, clusterAgentTokenHash, err = clusteragent.NewToken()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		clusterAgentPublicKey, clusterAgentPrivateKey, err = clusteragent.NewRegistrationKeyPair()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		clusterAgentManifestGrant, err = cm.clusterAgentManager.CreateManifestGrant(clusterAgentToken)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	cluster := &model.Cluster{
		Name:                   req.Name,
		Description:            req.Description,
		Config:                 model.SecretString(req.Config),
		PrometheusURL:          req.PrometheusURL,
		InCluster:              req.InCluster,
		ClusterAgent:           req.ClusterAgent,
		ClusterAgentTokenHash:  clusterAgentTokenHash,
		ClusterAgentPublicKey:  clusterAgentPublicKey,
		ClusterAgentPrivateKey: model.SecretString(clusterAgentPrivateKey),
		IsDefault:              req.IsDefault,
		Enable:                 true,
	}

	if err := model.AddCluster(cluster); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	TriggerClusterSync()

	result := gin.H{
		"id":      cluster.ID,
		"message": "cluster created successfully",
	}
	if req.ClusterAgent {
		serverURL := clusterAgentServerURL(c)
		result["clusterAgentServer"] = serverURL
		result["clusterAgentToken"] = clusterAgentToken
		result["clusterAgentPublicKey"] = clusterAgentPublicKey
		result["clusterAgentManifestURL"] = fmt.Sprintf("%s/api/v1/cluster-agent/manifest?grant=%s", strings.TrimRight(serverURL, "/"), clusterAgentManifestGrant)
	}
	c.JSON(http.StatusCreated, result)
}

func (cm *ClusterManager) UpdateCluster(c *gin.Context) {
	if common.IsSectionManaged("clusters") {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
		return
	}

	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cluster id"})
		return
	}

	var req struct {
		Name          string `json:"name"`
		Description   string `json:"description"`
		Config        string `json:"config"`
		PrometheusURL string `json:"prometheusURL"`
		InCluster     bool   `json:"inCluster"`
		IsDefault     bool   `json:"isDefault"`
		Enabled       bool   `json:"enabled"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	cluster, err := model.GetClusterByID(uint(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	if req.IsDefault && !cluster.IsDefault {
		if err := model.ClearDefaultCluster(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	if cluster.ClusterAgent {
		req.InCluster = false
		req.Config = ""
	}

	updates := map[string]interface{}{
		"description":    req.Description,
		"prometheus_url": req.PrometheusURL,
		"in_cluster":     req.InCluster,
		"is_default":     req.IsDefault,
		"enable":         req.Enabled,
	}

	if req.Name != "" && req.Name != cluster.Name {
		updates["name"] = req.Name
	}

	if req.Config != "" {
		updates["config"] = model.SecretString(req.Config)
	}

	if err := model.UpdateCluster(cluster, updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	TriggerClusterSync()

	c.JSON(http.StatusOK, gin.H{"message": "cluster updated successfully"})
}

func (cm *ClusterManager) DeleteCluster(c *gin.Context) {
	if common.IsSectionManaged("clusters") {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
		return
	}

	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cluster id"})
		return
	}

	cluster, err := model.GetClusterByID(uint(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	if cluster.IsDefault {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot delete default cluster"})
		return
	}

	if err := model.DeleteCluster(cluster); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if cluster.ClusterAgent {
		cm.clusterAgentManager.Remove(cluster.ID)
	}

	TriggerClusterSync()

	c.JSON(http.StatusOK, gin.H{"message": "cluster deleted successfully"})
}

func (cm *ClusterManager) ConnectClusterAgent(c *gin.Context) {
	cm.clusterAgentManager.ServeHTTP(c.Writer, c.Request)
}

func (cm *ClusterManager) RegisterClusterAgent(c *gin.Context) {
	cm.clusterAgentManager.Register(c.Writer, c.Request)
}

func (cm *ClusterManager) GetClusterAgentManifest(c *gin.Context) {
	grant := strings.TrimSpace(c.Query("grant"))
	token, err := cm.clusterAgentManager.ResolveManifestGrant(grant)
	if errors.Is(err, clusteragent.ErrInvalidManifestGrant) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired manifest grant"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to validate manifest grant"})
		return
	}
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired manifest grant"})
		return
	}
	publicKey, err := cm.clusterAgentManager.RegistrationPublicKey(token)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load cluster agent registration key"})
		return
	}
	if publicKey == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired manifest grant"})
		return
	}
	serverURL := clusterAgentServerURL(c)
	image := model.DefaultGeneralClusterAgentImageValue()
	if setting, err := model.GetGeneralSetting(); err == nil && setting != nil && setting.ClusterAgentImage != "" {
		image = setting.ClusterAgentImage
	}
	manifest := clusteragent.GenerateManifest(serverURL, token, publicKey, image)
	c.Header("Cache-Control", "no-store")
	c.Header("Content-Disposition", `attachment; filename="kite-cluster-agent.yaml"`)
	c.Data(http.StatusOK, "text/yaml; charset=utf-8", []byte(manifest))
}

func (cm *ClusterManager) ImportClustersFromKubeconfig(c *gin.Context) {
	if common.IsSectionManaged("clusters") {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
		return
	}

	var clusterReq common.ImportClustersRequest
	if err := c.ShouldBindJSON(&clusterReq); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !clusterReq.InCluster && clusterReq.Config == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "config is required when inCluster is false"})
		return
	}

	cc, err := model.CountClusters()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if clusterReq.InCluster && cc > 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "in-cluster import not allowed when clusters exist"})
		return
	}

	if clusterReq.InCluster {
		// In-cluster config
		cluster := &model.Cluster{
			Name:        "in-cluster",
			InCluster:   true,
			Description: "Kubernetes in-cluster config",
			IsDefault:   true,
			Enable:      true,
		}
		if err := model.AddCluster(cluster); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		TriggerClusterSync()
		// wait for sync to complete
		time.Sleep(1 * time.Second)
		c.JSON(http.StatusCreated, gin.H{
			"message":       fmt.Sprintf("imported %d clusters successfully", 1),
			"importedCount": 1,
		})
		return
	}

	kubeconfig, err := clientcmd.Load([]byte(clusterReq.Config))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	importedCount := ImportClustersFromKubeconfig(kubeconfig, cc == 0)
	TriggerClusterSync()
	// wait for sync to complete
	time.Sleep(1 * time.Second)
	c.JSON(http.StatusCreated, gin.H{
		"message":       fmt.Sprintf("imported %d clusters successfully", importedCount),
		"importedCount": importedCount,
	})
}
