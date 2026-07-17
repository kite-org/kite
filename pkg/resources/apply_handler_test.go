package resources

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func TestApplyResourceUsesRESTMappingForRBAC(t *testing.T) {
	originalDB := model.DB
	originalGinMode := gin.Mode()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get database: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	model.DB = db
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() {
		model.DB = originalDB
		gin.SetMode(originalGinMode)
		_ = sqlDB.Close()
	})
	if err := db.Exec("PRAGMA foreign_keys = ON").Error; err != nil {
		t.Fatalf("enable foreign keys: %v", err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.ResourceHistory{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}

	user := model.User{Username: "alice"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	evilVersion := schema.GroupVersion{Group: "evil.example", Version: "v1"}
	ingressVersion := schema.GroupVersion{Group: "networking.k8s.io", Version: "v1"}
	coreVersion := schema.GroupVersion{Version: "v1"}
	evilPodGVK := evilVersion.WithKind("Pod")
	ingressGVK := ingressVersion.WithKind("Ingress")
	nodeGVK := coreVersion.WithKind("Node")
	mapper := meta.NewDefaultRESTMapper([]schema.GroupVersion{evilVersion, ingressVersion, coreVersion})
	mapper.AddSpecific(evilPodGVK, evilVersion.WithResource("pods"), evilVersion.WithResource("pod"), meta.RESTScopeNamespace)
	mapper.AddSpecific(ingressGVK, ingressVersion.WithResource("ingresses"), ingressVersion.WithResource("ingress"), meta.RESTScopeNamespace)
	mapper.AddSpecific(nodeGVK, coreVersion.WithResource("nodes"), coreVersion.WithResource("node"), meta.RESTScopeRoot)

	scheme := runtime.NewScheme()
	scheme.AddKnownTypeWithName(evilPodGVK, &unstructured.Unstructured{})
	scheme.AddKnownTypeWithName(ingressGVK, &unstructured.Unstructured{})
	scheme.AddKnownTypeWithName(nodeGVK, &unstructured.Unstructured{})
	k8sClient := fake.NewClientBuilder().WithScheme(scheme).WithRESTMapper(mapper).Build()
	clientSet := &cluster.ClientSet{
		Name:      "prod",
		K8sClient: &kube.K8sClient{Client: k8sClient},
	}
	handler := NewResourceApplyHandler()
	perform := func(user model.User, manifest string) *httptest.ResponseRecorder {
		body, err := json.Marshal(ApplyResourceRequest{YAML: manifest})
		if err != nil {
			t.Fatalf("marshal request: %v", err)
		}
		router := gin.New()
		router.POST("/apply", func(c *gin.Context) {
			c.Set("cluster", clientSet)
			c.Set("user", user)
			handler.ApplyResource(c)
		})
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/apply", strings.NewReader(string(body)))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(response, request)
		return response
	}

	t.Run("custom resource cannot borrow built-in kind permission", func(t *testing.T) {
		requestUser := user
		requestUser.Roles = []common.Role{{
			Name:       "pod-creator",
			Clusters:   []string{"prod"},
			Namespaces: []string{"default"},
			Resources:  []string{"pods"},
			Verbs:      []string{string(common.VerbCreate)},
		}}
		response := perform(requestUser, `apiVersion: evil.example/v1
kind: Pod
metadata:
  name: hijack
  namespace: default
`)
		if response.Code != http.StatusForbidden {
			t.Fatalf("apply returned %d, want %d; body=%s", response.Code, http.StatusForbidden, response.Body.String())
		}
		if !strings.Contains(response.Body.String(), "pods.evil.example") {
			t.Fatalf("response does not name mapped resource: %s", response.Body.String())
		}
		object := &unstructured.Unstructured{}
		object.SetGroupVersionKind(evilPodGVK)
		err := k8sClient.Get(context.Background(), client.ObjectKey{Name: "hijack", Namespace: "default"}, object)
		if !apierrors.IsNotFound(err) {
			t.Fatalf("custom pod exists after forbidden apply: %v", err)
		}
	})

	t.Run("namespace permission cannot create cluster scoped resource", func(t *testing.T) {
		requestUser := user
		requestUser.Roles = []common.Role{{
			Name:       "namespace-node-creator",
			Clusters:   []string{"prod"},
			Namespaces: []string{"default"},
			Resources:  []string{"nodes"},
			Verbs:      []string{string(common.VerbCreate)},
		}}
		response := perform(requestUser, `apiVersion: v1
kind: Node
metadata:
  name: hijack
  namespace: default
`)
		if response.Code != http.StatusForbidden {
			t.Fatalf("apply returned %d, want %d; body=%s", response.Code, http.StatusForbidden, response.Body.String())
		}
		object := &unstructured.Unstructured{}
		object.SetGroupVersionKind(nodeGVK)
		err := k8sClient.Get(context.Background(), client.ObjectKey{Name: "hijack"}, object)
		if !apierrors.IsNotFound(err) {
			t.Fatalf("node exists after forbidden apply: %v", err)
		}
	})

	t.Run("irregular plural uses mapped resource permission", func(t *testing.T) {
		requestUser := user
		requestUser.Roles = []common.Role{{
			Name:       "ingress-creator",
			Clusters:   []string{"prod"},
			Namespaces: []string{"default"},
			Resources:  []string{"ingresses"},
			Verbs:      []string{string(common.VerbCreate)},
		}}
		response := perform(requestUser, `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
  namespace: default
spec: {}
`)
		if response.Code != http.StatusOK {
			t.Fatalf("apply returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
		}
		object := &unstructured.Unstructured{}
		object.SetGroupVersionKind(ingressGVK)
		if err := k8sClient.Get(context.Background(), client.ObjectKey{Name: "web", Namespace: "default"}, object); err != nil {
			t.Fatalf("get created ingress: %v", err)
		}
		var history model.ResourceHistory
		if err := db.First(&history).Error; err != nil {
			t.Fatalf("get resource history: %v", err)
		}
		if history.ResourceType != "ingresses" {
			t.Fatalf("history resource type = %q, want ingresses", history.ResourceType)
		}
	})

	t.Run("all namespaces permission can create cluster scoped resource", func(t *testing.T) {
		requestUser := user
		requestUser.Roles = []common.Role{{
			Name:       "cluster-node-creator",
			Clusters:   []string{"prod"},
			Namespaces: []string{common.AllNamespaces},
			Resources:  []string{"nodes"},
			Verbs:      []string{string(common.VerbCreate)},
		}}
		response := perform(requestUser, `apiVersion: v1
kind: Node
metadata:
  name: worker
  namespace: default
  labels:
    state: original
`)
		if response.Code != http.StatusOK {
			t.Fatalf("apply returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
		}
		object := &unstructured.Unstructured{}
		object.SetGroupVersionKind(nodeGVK)
		if err := k8sClient.Get(context.Background(), client.ObjectKey{Name: "worker"}, object); err != nil {
			t.Fatalf("get created node: %v", err)
		}
		if object.GetNamespace() != "" {
			t.Fatalf("node namespace = %q, want empty", object.GetNamespace())
		}
	})

	t.Run("namespace permission cannot update cluster scoped resource", func(t *testing.T) {
		requestUser := user
		requestUser.Roles = []common.Role{{
			Name:       "namespace-node-updater",
			Clusters:   []string{"prod"},
			Namespaces: []string{"default"},
			Resources:  []string{"nodes"},
			Verbs:      []string{string(common.VerbUpdate)},
		}}
		response := perform(requestUser, `apiVersion: v1
kind: Node
metadata:
  name: worker
  namespace: default
  labels:
    state: changed
`)
		if response.Code != http.StatusForbidden {
			t.Fatalf("apply returned %d, want %d; body=%s", response.Code, http.StatusForbidden, response.Body.String())
		}
		object := &unstructured.Unstructured{}
		object.SetGroupVersionKind(nodeGVK)
		if err := k8sClient.Get(context.Background(), client.ObjectKey{Name: "worker"}, object); err != nil {
			t.Fatalf("get existing node: %v", err)
		}
		if object.GetLabels()["state"] != "original" {
			t.Fatalf("node was modified after forbidden apply: %#v", object.GetLabels())
		}
	})
}
