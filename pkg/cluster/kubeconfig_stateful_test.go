package cluster

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"github.com/zxh326/kite/pkg/statefultoken"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

func TestDownloadKubeconfigCreatesOneJWTAndTokenRecord(t *testing.T) {
	setupKubeconfigStatefulTest(t)
	user := createKubeconfigTestUser(t, "alice")
	first := createKubeconfigTestCluster(t, "first cluster")
	second := createKubeconfigTestCluster(t, "second/cluster")
	setKubeconfigTestRBAC(t, user.Username, []string{"*"})

	manager := &ClusterManager{}
	router := gin.New()
	router.POST("/kubeconfig", withKubeconfigTestUser(user), manager.DownloadKubeconfig)
	response := performKubeconfigRequest(router, http.MethodPost, "/kubeconfig", fmt.Sprintf(`{"clusterUUIDs":[%q,%q,%q],"ttlSeconds":3600}`, first.UUID, second.UUID, first.UUID), map[string]string{
		"X-Forwarded-Proto": "https",
		"X-Forwarded-Host":  "kite.example.test",
		"X-Cluster-Name":    second.Name,
	})
	if response.Code != http.StatusOK {
		t.Fatalf("download status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if got := response.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/yaml") {
		t.Fatalf("Content-Type = %q", got)
	}
	if response.Header().Get("Content-Disposition") != `attachment; filename="kite-kubeconfig.yaml"` || response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("Pragma") != "no-cache" {
		t.Fatalf("download headers = %#v", response.Header())
	}
	config, err := clientcmd.Load(response.Body.Bytes())
	if err != nil {
		t.Fatalf("parse kubeconfig: %v", err)
	}
	if len(config.Clusters) != 2 || len(config.Contexts) != 2 || config.CurrentContext != "second-cluster" {
		t.Fatalf("kubeconfig clusters=%d contexts=%d current=%q", len(config.Clusters), len(config.Contexts), config.CurrentContext)
	}
	token := config.AuthInfos["kite-kubeconfig"].Token
	if token == "" || len(config.AuthInfos) != 1 {
		t.Fatalf("auth infos = %#v", config.AuthInfos)
	}
	for _, cluster := range config.Clusters {
		if !strings.Contains(cluster.Server, "/api/v1/clusters/") || !strings.HasSuffix(cluster.Server, "/k8s-proxy") {
			t.Fatalf("unexpected proxy server URL %q", cluster.Server)
		}
	}
	service, err := newKubeconfigTokenService()
	if err != nil {
		t.Fatal(err)
	}
	principal, err := service.Authenticate(context.Background(), token)
	if err != nil || principal.SubjectID != fmt.Sprint(user.ID) {
		t.Fatalf("issued JWT principal=%#v err=%v", principal, err)
	}
	var records []model.KubeconfigToken
	if err := model.DB.Find(&records).Error; err != nil || len(records) != 1 {
		t.Fatalf("token records=%#v err=%v", records, err)
	}
	record := records[0]
	if record.OwnerID != user.ID || len(record.JTIHash) != 64 || record.SigningKeyID != common.KubeconfigJWTKID {
		t.Fatalf("token record = %#v", record)
	}
	if delta := record.ExpiresAt.Sub(record.CreatedAt); delta < 59*time.Minute || delta > 61*time.Minute {
		t.Fatalf("token TTL = %s", delta)
	}
}

func TestDownloadKubeconfigKeepsCollidingClusterNamesDistinct(t *testing.T) {
	setupKubeconfigStatefulTest(t)
	user := createKubeconfigTestUser(t, "collision-user")
	first := createKubeconfigTestCluster(t, "prod/a")
	second := createKubeconfigTestCluster(t, "prod-a")
	setKubeconfigTestRBAC(t, user.Username, []string{"*"})

	manager := &ClusterManager{}
	router := gin.New()
	router.POST("/kubeconfig", withKubeconfigTestUser(user), manager.DownloadKubeconfig)
	response := performKubeconfigRequest(router, http.MethodPost, "/kubeconfig", fmt.Sprintf(`{"clusterUUIDs":[%q,%q],"ttlSeconds":3600}`, first.UUID, second.UUID), map[string]string{
		"X-Cluster-Name": first.Name,
	})
	if response.Code != http.StatusOK {
		t.Fatalf("download status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	config, err := clientcmd.Load(response.Body.Bytes())
	if err != nil {
		t.Fatalf("parse kubeconfig: %v", err)
	}
	if len(config.Clusters) != 2 || len(config.Contexts) != 2 || config.CurrentContext != "prod-a" {
		t.Fatalf("kubeconfig clusters=%d contexts=%d current=%q", len(config.Clusters), len(config.Contexts), config.CurrentContext)
	}
	if config.Contexts[config.CurrentContext].Cluster != config.CurrentContext || !strings.Contains(config.Clusters[config.CurrentContext].Server, first.UUID) {
		t.Fatalf("current context points to %#v", config.Contexts[config.CurrentContext])
	}
	if _, ok := config.Clusters["prod-a-2"]; !ok {
		t.Fatalf("collision entry missing: %#v", config.Clusters)
	}
}

func TestK8sProxyRejectsUnsupportedNonResourcePath(t *testing.T) {
	setupKubeconfigStatefulTest(t)
	user := createKubeconfigTestUser(t, "proxy-user")
	cluster := createKubeconfigTestCluster(t, "proxy-cluster")
	setKubeconfigTestRBAC(t, user.Username, []string{cluster.Name})
	service, err := newKubeconfigTokenService()
	if err != nil {
		t.Fatal(err)
	}
	issued, err := service.Issue(context.Background(), statefultoken.IssueRequest{SubjectID: fmt.Sprint(user.ID), Name: "proxy", ExpiresAt: time.Now().UTC().Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	token := issued.Encoded

	manager := &ClusterManager{}
	router := gin.New()
	router.Any("/clusters/:clusterUUID/k8s-proxy/*path", manager.HandleK8sProxy)
	response := performKubeconfigRequest(router, http.MethodGet, fmt.Sprintf("/clusters/%s/k8s-proxy/healthz", cluster.UUID), "", map[string]string{"Authorization": "Bearer " + token})
	if response.Code != http.StatusForbidden {
		t.Fatalf("non-resource proxy status = %d, want %d: %s", response.Code, http.StatusForbidden, response.Body.String())
	}
}

func TestBuildUpgradeConnectionTransportPreservesDialer(t *testing.T) {
	sentinel := fmt.Errorf("agent dialer used")
	transport, err := buildUpgradeConnectionTransport(&rest.Config{
		Host: "https://10.247.0.1:443",
		TLSClientConfig: rest.TLSClientConfig{
			Insecure: true,
		},
		Dial: func(_ context.Context, network, address string) (net.Conn, error) {
			if network != "tcp" || address != "10.247.0.1:443" {
				t.Fatalf("Dial called with network=%q address=%q", network, address)
			}
			return nil, sentinel
		},
	})
	if err != nil {
		t.Fatalf("buildUpgradeConnectionTransport() error = %v", err)
	}
	if transport.DialContext == nil {
		t.Fatal("DialContext is nil")
	}
	_, err = transport.DialContext(context.Background(), "tcp", "10.247.0.1:443")
	if !errors.Is(err, sentinel) {
		t.Fatalf("DialContext() error = %v, want %v", err, sentinel)
	}
	if got := transport.TLSClientConfig.NextProtos; len(got) != 1 || got[0] != "http/1.1" {
		t.Fatalf("NextProtos = %#v, want []string{\"http/1.1\"}", got)
	}
}

func TestDownloadKubeconfigRejectsTTLAndUnauthorizedClusters(t *testing.T) {
	setupKubeconfigStatefulTest(t)
	user := createKubeconfigTestUser(t, "limited")
	allowed := createKubeconfigTestCluster(t, "allowed")
	blocked := createKubeconfigTestCluster(t, "blocked")
	setKubeconfigTestRBAC(t, user.Username, []string{allowed.Name})
	manager := &ClusterManager{}
	router := gin.New()
	router.POST("/kubeconfig", withKubeconfigTestUser(user), manager.DownloadKubeconfig)

	for _, ttl := range []int64{minKubeconfigTTL - 1, maxKubeconfigTTL + 1} {
		response := performKubeconfigRequest(router, http.MethodPost, "/kubeconfig", fmt.Sprintf(`{"clusterUUIDs":[%q],"ttlSeconds":%d}`, allowed.UUID, ttl), nil)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("TTL %d status = %d, want %d", ttl, response.Code, http.StatusBadRequest)
		}
	}
	response := performKubeconfigRequest(router, http.MethodPost, "/kubeconfig", fmt.Sprintf(`{"clusterUUIDs":[%q],"ttlSeconds":%d}`, blocked.UUID, minKubeconfigTTL), nil)
	if response.Code != http.StatusForbidden {
		t.Fatalf("unauthorized cluster status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestKubeconfigTokenListAndDeleteRespectOwnershipAndRedactJTI(t *testing.T) {
	setupKubeconfigStatefulTest(t)
	owner := createKubeconfigTestUser(t, "owner")
	other := createKubeconfigTestUser(t, "other")
	ownerToken := createKubeconfigTestToken(t, owner, "owner token", time.Now().UTC().Add(time.Hour))
	service, err := newKubeconfigTokenService()
	if err != nil {
		t.Fatal(err)
	}
	otherIssued, err := service.Issue(context.Background(), statefultoken.IssueRequest{SubjectID: fmt.Sprint(other.ID), Name: "other token", ExpiresAt: time.Now().UTC().Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	otherToken := &model.KubeconfigToken{Model: model.Model{ID: otherIssued.Record.ID}, JTIHash: otherIssued.Record.JTIHash}
	router := gin.New()
	router.GET("/me/tokens", withKubeconfigTestUser(owner), ListCurrentUserKubeconfigTokens)
	router.DELETE("/me/tokens/:id", withKubeconfigTestUser(owner), DeleteCurrentUserKubeconfigToken)
	router.GET("/admin/tokens", withKubeconfigTestUser(owner), ListAllKubeconfigTokens)
	router.DELETE("/admin/tokens/:id", withKubeconfigTestUser(owner), DeleteAnyKubeconfigToken)

	list := performKubeconfigRequest(router, http.MethodGet, "/me/tokens", "", nil)
	if list.Code != http.StatusOK || strings.Contains(list.Body.String(), "jtiHash") || strings.Contains(list.Body.String(), ownerToken.JTIHash) {
		t.Fatalf("user token list status=%d body=%s", list.Code, list.Body.String())
	}
	var ownResponse struct {
		Tokens []map[string]any `json:"tokens"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &ownResponse); err != nil || len(ownResponse.Tokens) != 1 || ownResponse.Tokens[0]["ownerId"] != nil || ownResponse.Tokens[0]["owner"] != nil {
		t.Fatalf("user token response=%#v err=%v", ownResponse, err)
	}

	denied := performKubeconfigRequest(router, http.MethodDelete, fmt.Sprintf("/me/tokens/%d", otherToken.ID), "", nil)
	if denied.Code != http.StatusNotFound {
		t.Fatalf("cross-owner delete status = %d, want %d", denied.Code, http.StatusNotFound)
	}
	adminList := performKubeconfigRequest(router, http.MethodGet, "/admin/tokens", "", nil)
	if adminList.Code != http.StatusOK || !strings.Contains(adminList.Body.String(), `"owner":"owner"`) || strings.Contains(adminList.Body.String(), otherToken.JTIHash) {
		t.Fatalf("admin token list status=%d body=%s", adminList.Code, adminList.Body.String())
	}
	deleted := performKubeconfigRequest(router, http.MethodDelete, fmt.Sprintf("/admin/tokens/%d", otherToken.ID), "", nil)
	if deleted.Code != http.StatusOK {
		t.Fatalf("admin delete status = %d", deleted.Code)
	}
	var reloaded model.KubeconfigToken
	if err := model.DB.First(&reloaded, otherToken.ID).Error; !model.IsKubeconfigTokenNotFound(err) {
		t.Fatalf("deleted record=%#v err=%v", reloaded, err)
	}
	if _, err := service.Authenticate(context.Background(), otherIssued.Encoded); err == nil {
		t.Fatal("deleted token still authenticated")
	}
}

func TestAdminKubeconfigTokenListPaginationAndFilters(t *testing.T) {
	setupKubeconfigStatefulTest(t)
	alice := createKubeconfigTestUser(t, "Alice")
	bob := createKubeconfigTestUser(t, "bob")
	now := time.Now().UTC()
	active := createKubeconfigTestToken(t, alice, "active", now.Add(time.Hour))
	expired := createKubeconfigTestToken(t, alice, "expired", now.Add(-time.Hour))
	bobActive := createKubeconfigTestToken(t, bob, "bob active", now.Add(time.Hour))
	createdAt := map[uint]time.Time{
		active.ID: now.Add(-time.Hour), expired.ID: now.Add(-2 * time.Hour), bobActive.ID: now.Add(-3 * time.Hour),
	}
	for id, value := range createdAt {
		if err := model.DB.Model(&model.KubeconfigToken{}).Where("id = ?", id).Update("created_at", value).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	router.GET("/admin/tokens", withKubeconfigTestUser(alice), ListAllKubeconfigTokens)

	list := performKubeconfigRequest(router, http.MethodGet, "/admin/tokens?page=1&size=2", "", nil)
	var response struct {
		Tokens []struct {
			ID uint `json:"id"`
		} `json:"tokens"`
		Total int64 `json:"total"`
		Page  int   `json:"page"`
		Size  int   `json:"size"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &response); err != nil || list.Code != http.StatusOK || response.Total != 3 || response.Page != 1 || response.Size != 2 || len(response.Tokens) != 2 || response.Tokens[0].ID != active.ID || response.Tokens[1].ID != expired.ID {
		t.Fatalf("paginated response=%s err=%v", list.Body.String(), err)
	}
	ownerFiltered := performKubeconfigRequest(router, http.MethodGet, "/admin/tokens?owner=ALI", "", nil)
	if err := json.Unmarshal(ownerFiltered.Body.Bytes(), &response); err != nil || ownerFiltered.Code != http.StatusOK || response.Total != 2 || len(response.Tokens) != 2 || response.Tokens[0].ID != active.ID || response.Tokens[1].ID != expired.ID {
		t.Fatalf("owner-filtered response=%s err=%v", ownerFiltered.Body.String(), err)
	}
	for _, test := range []struct {
		query string
		want  []uint
	}{
		{"status=active", []uint{active.ID, bobActive.ID}},
		{"status=expired", []uint{expired.ID}},
	} {
		result := performKubeconfigRequest(router, http.MethodGet, "/admin/tokens?"+test.query, "", nil)
		if err := json.Unmarshal(result.Body.Bytes(), &response); err != nil || result.Code != http.StatusOK || response.Total != int64(len(test.want)) || len(response.Tokens) != len(test.want) {
			t.Fatalf("query %q response=%s err=%v", test.query, result.Body.String(), err)
		}
		for i, id := range test.want {
			if response.Tokens[i].ID != id {
				t.Fatalf("query %q token %d = %d, want %d", test.query, i, response.Tokens[i].ID, id)
			}
		}
	}
	for _, query := range []string{"page=0", "page=bad", "size=0", "size=101", "size=bad", "status=invalid", "status=revoked"} {
		result := performKubeconfigRequest(router, http.MethodGet, "/admin/tokens?"+query, "", nil)
		if result.Code != http.StatusBadRequest {
			t.Fatalf("query %q status=%d, want %d", query, result.Code, http.StatusBadRequest)
		}
	}
}

func TestKubeconfigJWTValidationAndAuthenticationState(t *testing.T) {
	setupKubeconfigStatefulTest(t)
	owner := createKubeconfigTestUser(t, "jwt-owner")
	service, err := newKubeconfigTokenService()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	expired, err := service.Issue(context.Background(), statefultoken.IssueRequest{SubjectID: fmt.Sprint(owner.ID), Name: "expired", ExpiresAt: now.Add(-time.Hour)})
	if !errors.Is(err, statefultoken.ErrInvalidToken) || expired.Encoded != "" {
		t.Fatalf("expired token issue error = %v", err)
	}

	issued, err := service.Issue(context.Background(), statefultoken.IssueRequest{SubjectID: fmt.Sprint(owner.ID), Name: "active", ExpiresAt: now.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	assertKubeconfigAuthStatus(t, &ClusterManager{}, issued.Encoded, http.StatusOK, "")
	deleted, err := model.DeleteKubeconfigToken(issued.Record.ID, &owner.ID)
	if err != nil || !deleted {
		t.Fatalf("delete token deleted=%v err=%v", deleted, err)
	}
	assertKubeconfigAuthStatus(t, &ClusterManager{}, issued.Encoded, http.StatusUnauthorized, "invalid kubeconfig token")

	disabledOwnerToken, issueErr := service.Issue(context.Background(), statefultoken.IssueRequest{SubjectID: fmt.Sprint(owner.ID), Name: "disabled-owner", ExpiresAt: now.Add(time.Hour)})
	if issueErr != nil {
		t.Fatal(issueErr)
	}
	if err := model.SetUserEnabled(owner.ID, false); err != nil {
		t.Fatal(err)
	}
	assertKubeconfigAuthStatus(t, &ClusterManager{}, disabledOwnerToken.Encoded, http.StatusUnauthorized, "invalid kubeconfig token")
}

func assertKubeconfigAuthStatus(t *testing.T, manager *ClusterManager, token string, wantCode int, wantMessage string) {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	ctx.Request.Header.Set("Authorization", "Bearer "+token)
	_, ok := manager.authenticateKubeconfigToken(ctx)
	if ok != (wantCode == http.StatusOK) || recorder.Code != wantCode {
		t.Fatalf("authenticated=%v status=%d, want status=%d", ok, recorder.Code, wantCode)
	}
	if wantCode != http.StatusOK {
		var status v1.Status
		if err := json.Unmarshal(recorder.Body.Bytes(), &status); err != nil || status.Kind != "Status" || status.Reason != v1.StatusReasonUnauthorized || !strings.Contains(status.Message, wantMessage) {
			t.Fatalf("Kubernetes status=%#v err=%v", status, err)
		}
	}
}

func setupKubeconfigStatefulTest(t *testing.T) {
	t.Helper()
	originalDB := model.DB
	originalSecret, originalKID := common.KubeconfigJWTSecret, common.KubeconfigJWTKID
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.Cluster{}, &model.KubeconfigToken{}); err != nil {
		t.Fatal(err)
	}
	model.DB = db
	common.KubeconfigJWTSecret, common.KubeconfigJWTKID = "stateful-kubeconfig-test-secret", "stateful-test-kid"
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() {
		model.InvalidateUserCache(1)
		model.InvalidateUserCache(2)
		model.DB = originalDB
		common.KubeconfigJWTSecret, common.KubeconfigJWTKID = originalSecret, originalKID
		sqlDB, _ := db.DB()
		if sqlDB != nil {
			_ = sqlDB.Close()
		}
	})
}

func createKubeconfigTestUser(t *testing.T, username string) model.User {
	t.Helper()
	user := model.User{Username: username, Enabled: true}
	if err := model.DB.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	model.InvalidateUserCache(uint64(user.ID))
	return user
}

func createKubeconfigTestCluster(t *testing.T, name string) model.Cluster {
	t.Helper()
	cluster := model.Cluster{Name: name, Enable: true}
	if err := model.DB.Create(&cluster).Error; err != nil {
		t.Fatal(err)
	}
	return cluster
}

func createKubeconfigTestToken(t *testing.T, owner model.User, name string, expiresAt time.Time) *model.KubeconfigToken {
	t.Helper()
	if !expiresAt.After(time.Now().UTC()) {
		record := &model.KubeconfigToken{
			JTIHash: statefultoken.HashJTI(name), OwnerID: owner.ID, Name: name,
			ExpiresAt: expiresAt, SigningKeyID: common.KubeconfigJWTKID,
		}
		if err := model.DB.Create(record).Error; err != nil {
			t.Fatal(err)
		}
		return record
	}
	service, err := newKubeconfigTokenService()
	if err != nil {
		t.Fatal(err)
	}
	issued, err := service.Issue(context.Background(), statefultoken.IssueRequest{SubjectID: fmt.Sprint(owner.ID), Name: name, ExpiresAt: expiresAt})
	if err != nil {
		t.Fatal(err)
	}
	var record model.KubeconfigToken
	if err := model.DB.First(&record, issued.Record.ID).Error; err != nil {
		t.Fatal(err)
	}
	return &record
}

func setKubeconfigTestRBAC(t *testing.T, username string, clusters []string) {
	t.Helper()
	original := rbac.RBACConfig
	rbac.RBACConfig = &common.RolesConfig{Roles: []common.Role{{Name: "download", Clusters: clusters, Resources: []string{"*"}, Namespaces: []string{"*"}, Verbs: []string{"*"}}}, RoleMapping: []common.RoleMapping{{Name: "download", Users: []string{username}}}}
	t.Cleanup(func() { rbac.RBACConfig = original })
}

func withKubeconfigTestUser(user model.User) gin.HandlerFunc {
	return func(c *gin.Context) { c.Set("user", user) }
}

func performKubeconfigRequest(router *gin.Engine, method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}
