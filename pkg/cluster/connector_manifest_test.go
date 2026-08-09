package cluster

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/connector"
	"github.com/zxh326/kite/pkg/model"
)

func TestGetConnectorManifest(t *testing.T) {
	setupClusterHandlerTestDB(t)

	token, hash, err := connector.NewToken()
	if err != nil {
		t.Fatalf("generating token: %v", err)
	}
	cluster := &model.Cluster{
		Name:               "conn-cluster",
		Connector:          true,
		Enable:             true,
		ConnectorTokenHash: hash,
	}
	if err := model.AddCluster(cluster); err != nil {
		t.Fatalf("adding cluster: %v", err)
	}

	manager := &ClusterManager{clusters: map[string]*ClientSet{}, errors: map[string]string{}, connectorManager: connector.NewManager(func() {})}
	grant, err := manager.connectorManager.CreateManifestGrant(token)
	if err != nil {
		t.Fatalf("generating manifest grant: %v", err)
	}
	router := newConnectorManifestRouter(manager)

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
		"kite-connector",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("manifest missing %q:\n%s", want, body)
		}
	}
}

func TestGetConnectorManifestInvalidGrant(t *testing.T) {
	setupClusterHandlerTestDB(t)
	manager := &ClusterManager{clusters: map[string]*ClientSet{}, errors: map[string]string{}, connectorManager: connector.NewManager(func() {})}
	router := newConnectorManifestRouter(manager)

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

func TestGetConnectorManifestTokenNotAssociated(t *testing.T) {
	setupClusterHandlerTestDB(t)

	token, _, err := connector.NewToken()
	if err != nil {
		t.Fatalf("generating token: %v", err)
	}

	manager := &ClusterManager{clusters: map[string]*ClientSet{}, errors: map[string]string{}, connectorManager: connector.NewManager(func() {})}
	grant, err := manager.connectorManager.CreateManifestGrant(token)
	if err != nil {
		t.Fatalf("generating manifest grant: %v", err)
	}
	router := newConnectorManifestRouter(manager)

	rec := performClusterRequest(router, http.MethodGet, "/manifest?grant="+grant, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unassociated token: status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestGetConnectorManifestDisabledCluster(t *testing.T) {
	setupClusterHandlerTestDB(t)

	token, hash, err := connector.NewToken()
	if err != nil {
		t.Fatalf("generating token: %v", err)
	}
	cluster := &model.Cluster{
		Name:               "disabled-conn",
		Connector:          true,
		Enable:             true,
		ConnectorTokenHash: hash,
	}
	if err := model.AddCluster(cluster); err != nil {
		t.Fatalf("adding cluster: %v", err)
	}
	if err := model.UpdateCluster(cluster, map[string]interface{}{"enable": false}); err != nil {
		t.Fatalf("disabling cluster: %v", err)
	}

	manager := &ClusterManager{clusters: map[string]*ClientSet{}, errors: map[string]string{}, connectorManager: connector.NewManager(func() {})}
	grant, err := manager.connectorManager.CreateManifestGrant(token)
	if err != nil {
		t.Fatalf("generating manifest grant: %v", err)
	}
	router := newConnectorManifestRouter(manager)

	rec := performClusterRequest(router, http.MethodGet, "/manifest?grant="+grant, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("disabled cluster: status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestCreateConnectorClusterReturnsConnectionInfo(t *testing.T) {
	setupClusterHandlerTestDB(t)

	manager := &ClusterManager{clusters: map[string]*ClientSet{}, errors: map[string]string{}, connectorManager: connector.NewManager(func() {})}
	router := gin.New()
	router.POST("/clusters", manager.CreateCluster)

	rec := performClusterRequest(router, http.MethodPost, "/clusters",
		`{"name":"conn-test","connector":true}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var result map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decoding response: %v", err)
	}

	serverURL, _ := result["connectorServer"].(string)
	token, _ := result["connectorToken"].(string)
	manifestURL, _ := result["connectorManifestURL"].(string)

	if serverURL == "" {
		t.Fatal("connectorServer is empty")
	}
	if token == "" {
		t.Fatal("connectorToken is empty")
	}
	if manifestURL == "" {
		t.Fatal("connectorManifestURL is empty")
	}
	if !strings.HasPrefix(manifestURL, serverURL) {
		t.Errorf("manifestURL %q should start with serverURL %q", manifestURL, serverURL)
	}
	if strings.Contains(manifestURL, token) {
		t.Errorf("manifestURL %q should not contain the connector token", manifestURL)
	}
	if !strings.Contains(manifestURL, "?grant=") {
		t.Errorf("manifestURL %q should contain a manifest grant", manifestURL)
	}
	// Verify the cluster was persisted correctly.
	cluster, err := model.GetClusterByName("conn-test")
	if err != nil {
		t.Fatalf("loading cluster: %v", err)
	}
	if !cluster.Connector {
		t.Error("cluster.Connector should be true")
	}
	if cluster.ConnectorTokenHash == "" {
		t.Error("ConnectorTokenHash should not be empty")
	}
	if string(cluster.Config) != "" {
		t.Errorf("connector cluster should have empty config, got %q", cluster.Config)
	}
}

func TestCreateConnectorClusterIgnoresKubeconfig(t *testing.T) {
	setupClusterHandlerTestDB(t)

	manager := &ClusterManager{clusters: map[string]*ClientSet{}, errors: map[string]string{}, connectorManager: connector.NewManager(func() {})}
	router := gin.New()
	router.POST("/clusters", manager.CreateCluster)

	rec := performClusterRequest(router, http.MethodPost, "/clusters",
		`{"name":"conn-ignore","connector":true,"config":"should-be-ignored","inCluster":true,"prometheusURL":"https://prom.example.com"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	cluster, err := model.GetClusterByName("conn-ignore")
	if err != nil {
		t.Fatalf("loading cluster: %v", err)
	}
	if string(cluster.Config) != "" {
		t.Errorf("connector cluster config should be empty, got %q", cluster.Config)
	}
	if cluster.InCluster {
		t.Error("connector cluster InCluster should be false")
	}
	if cluster.PrometheusURL != "" {
		t.Errorf("connector cluster PrometheusURL should be empty, got %q", cluster.PrometheusURL)
	}
}

func TestCreateConnectorClusterServerURLDerivation(t *testing.T) {
	setupClusterHandlerTestDB(t)

	manager := &ClusterManager{clusters: map[string]*ClientSet{}, errors: map[string]string{}, connectorManager: connector.NewManager(func() {})}
	router := gin.New()
	router.POST("/clusters", manager.CreateCluster)

	// Verify that X-Forwarded-Host and X-Forwarded-Proto are respected.
	rec := httptest.NewRecorder()
	body := strings.NewReader(`{"name":"conn-fwd","connector":true}`)
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
	serverURL, _ := result["connectorServer"].(string)
	if !strings.HasPrefix(serverURL, "https://kite.example.com") {
		t.Errorf("serverURL = %q, want https://kite.example.com prefix", serverURL)
	}
}

func newConnectorManifestRouter(manager *ClusterManager) *gin.Engine {
	router := gin.New()
	router.GET("/manifest", manager.GetConnectorManifest)
	return router
}
