package cluster

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/clusteragent"
	"github.com/zxh326/kite/pkg/model"
)

func TestGetClusterAgentManifest(t *testing.T) {
	setupClusterHandlerTestDB(t)

	token, hash, err := clusteragent.NewToken()
	if err != nil {
		t.Fatalf("generating token: %v", err)
	}
	publicKey, privateKey, err := clusteragent.NewRegistrationKeyPair()
	if err != nil {
		t.Fatalf("generating registration key pair: %v", err)
	}
	cluster := &model.Cluster{
		Name:                   "agent-cluster",
		ClusterAgent:           true,
		Enable:                 true,
		ClusterAgentTokenHash:  hash,
		ClusterAgentPublicKey:  publicKey,
		ClusterAgentPrivateKey: model.SecretString(privateKey),
	}
	if err := model.AddCluster(cluster); err != nil {
		t.Fatalf("adding cluster: %v", err)
	}

	manager := &ClusterManager{clusters: map[string]*ClientSet{}, errors: map[string]string{}, clusterAgentManager: clusteragent.NewManager(func() {})}
	grant, err := manager.clusterAgentManager.CreateManifestGrant(token)
	if err != nil {
		t.Fatalf("generating manifest grant: %v", err)
	}
	router := newClusterAgentManifestRouter(manager)

	rec := performClusterRequest(router, http.MethodGet, "/manifest?grant="+grant, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/yaml") {
		t.Fatalf("content-type = %q", ct)
	}
	body := rec.Body.String()
	for _, want := range []string{
		"kind: Secret",
		"kind: ServiceAccount",
		"kind: ClusterRoleBinding",
		"kind: Deployment",
		"kite-cluster-agent",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("manifest missing %q:\n%s", want, body)
		}
	}
}

func TestGetClusterAgentManifestInvalidGrant(t *testing.T) {
	setupClusterHandlerTestDB(t)
	manager := &ClusterManager{clusters: map[string]*ClientSet{}, errors: map[string]string{}, clusterAgentManager: clusteragent.NewManager(func() {})}
	router := newClusterAgentManifestRouter(manager)

	// Missing grant.
	rec := performClusterRequest(router, http.MethodGet, "/manifest", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing grant: status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}

	// Malformed grant.
	rec = performClusterRequest(router, http.MethodGet, "/manifest?grant=garbage", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("malformed grant: status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestGetClusterAgentManifestTokenNotAssociated(t *testing.T) {
	setupClusterHandlerTestDB(t)

	token, _, err := clusteragent.NewToken()
	if err != nil {
		t.Fatalf("generating token: %v", err)
	}

	manager := &ClusterManager{clusters: map[string]*ClientSet{}, errors: map[string]string{}, clusterAgentManager: clusteragent.NewManager(func() {})}
	grant, err := manager.clusterAgentManager.CreateManifestGrant(token)
	if err != nil {
		t.Fatalf("generating manifest grant: %v", err)
	}
	router := newClusterAgentManifestRouter(manager)

	rec := performClusterRequest(router, http.MethodGet, "/manifest?grant="+grant, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unassociated token: status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestGetClusterAgentManifestDisabledCluster(t *testing.T) {
	setupClusterHandlerTestDB(t)

	token, hash, err := clusteragent.NewToken()
	if err != nil {
		t.Fatalf("generating token: %v", err)
	}
	cluster := &model.Cluster{
		Name:                  "disabled-agent",
		ClusterAgent:          true,
		Enable:                true,
		ClusterAgentTokenHash: hash,
	}
	if err := model.AddCluster(cluster); err != nil {
		t.Fatalf("adding cluster: %v", err)
	}
	if err := model.UpdateCluster(cluster, map[string]interface{}{"enable": false}); err != nil {
		t.Fatalf("disabling cluster: %v", err)
	}

	manager := &ClusterManager{clusters: map[string]*ClientSet{}, errors: map[string]string{}, clusterAgentManager: clusteragent.NewManager(func() {})}
	grant, err := manager.clusterAgentManager.CreateManifestGrant(token)
	if err != nil {
		t.Fatalf("generating manifest grant: %v", err)
	}
	router := newClusterAgentManifestRouter(manager)

	rec := performClusterRequest(router, http.MethodGet, "/manifest?grant="+grant, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("disabled cluster: status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestCreateClusterAgentClusterReturnsConnectionInfo(t *testing.T) {
	setupClusterHandlerTestDB(t)

	manager := &ClusterManager{clusters: map[string]*ClientSet{}, errors: map[string]string{}, clusterAgentManager: clusteragent.NewManager(func() {})}
	router := gin.New()
	router.POST("/clusters", manager.CreateCluster)

	rec := performClusterRequest(router, http.MethodPost, "/clusters",
		`{"name":"agent-test","clusterAgent":true}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var result map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decoding response: %v", err)
	}

	serverURL, _ := result["clusterAgentServer"].(string)
	token, _ := result["clusterAgentToken"].(string)
	manifestURL, _ := result["clusterAgentManifestURL"].(string)

	if serverURL == "" {
		t.Fatal("clusterAgentServer is empty")
	}
	if token == "" {
		t.Fatal("clusterAgentToken is empty")
	}
	if manifestURL == "" {
		t.Fatal("clusterAgentManifestURL is empty")
	}
	if !strings.HasPrefix(manifestURL, serverURL) {
		t.Errorf("manifestURL %q should start with serverURL %q", manifestURL, serverURL)
	}
	if strings.Contains(manifestURL, token) {
		t.Errorf("manifestURL %q should not contain the cluster agent token", manifestURL)
	}
	if !strings.Contains(manifestURL, "?grant=") {
		t.Errorf("manifestURL %q should contain a manifest grant", manifestURL)
	}
	// Verify the cluster was persisted correctly.
	cluster, err := model.GetClusterByName("agent-test")
	if err != nil {
		t.Fatalf("loading cluster: %v", err)
	}
	if !cluster.ClusterAgent {
		t.Error("cluster.ClusterAgent should be true")
	}
	if cluster.ClusterAgentTokenHash == "" {
		t.Error("ClusterAgentTokenHash should not be empty")
	}
	if string(cluster.Config) != "" {
		t.Errorf("cluster agent cluster should have empty config, got %q", cluster.Config)
	}
}

func TestCreateClusterAgentClusterIgnoresKubeconfig(t *testing.T) {
	setupClusterHandlerTestDB(t)

	manager := &ClusterManager{clusters: map[string]*ClientSet{}, errors: map[string]string{}, clusterAgentManager: clusteragent.NewManager(func() {})}
	router := gin.New()
	router.POST("/clusters", manager.CreateCluster)

	rec := performClusterRequest(router, http.MethodPost, "/clusters",
		`{"name":"agent-ignore","clusterAgent":true,"config":"should-be-ignored","inCluster":true,"prometheusURL":"https://prom.example.com"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	cluster, err := model.GetClusterByName("agent-ignore")
	if err != nil {
		t.Fatalf("loading cluster: %v", err)
	}
	if string(cluster.Config) != "" {
		t.Errorf("cluster agent cluster config should be empty, got %q", cluster.Config)
	}
	if cluster.InCluster {
		t.Error("cluster agent cluster InCluster should be false")
	}
	if cluster.PrometheusURL != "https://prom.example.com" {
		t.Errorf("cluster agent cluster PrometheusURL = %q, want %q", cluster.PrometheusURL, "https://prom.example.com")
	}
}

func TestCreateClusterAgentClusterServerURLDerivation(t *testing.T) {
	setupClusterHandlerTestDB(t)

	manager := &ClusterManager{clusters: map[string]*ClientSet{}, errors: map[string]string{}, clusterAgentManager: clusteragent.NewManager(func() {})}
	router := gin.New()
	router.POST("/clusters", manager.CreateCluster)

	// Verify that X-Forwarded-Host and X-Forwarded-Proto are respected.
	rec := httptest.NewRecorder()
	body := strings.NewReader(`{"name":"agent-fwd","clusterAgent":true}`)
	req := httptest.NewRequest(http.MethodPost, "/clusters", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forwarded-Host", "kite.example.com")
	req.Header.Set("X-Forwarded-Proto", "https")
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var result map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	serverURL, _ := result["clusterAgentServer"].(string)
	if !strings.HasPrefix(serverURL, "https://kite.example.com") {
		t.Errorf("serverURL = %q, want https://kite.example.com prefix", serverURL)
	}
}

func newClusterAgentManifestRouter(manager *ClusterManager) *gin.Engine {
	router := gin.New()
	router.GET("/manifest", manager.GetClusterAgentManifest)
	return router
}
