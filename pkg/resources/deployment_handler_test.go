package resources

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	clientgofake "k8s.io/client-go/kubernetes/fake"
)

const deploymentTestUID = types.UID("demo-deployment-uid")

func setupWorkloadHandlerTestDB(t *testing.T) {
	t.Helper()
	oldDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get database: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&model.User{}, &model.ResourceHistory{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	model.DB = db
	t.Cleanup(func() {
		model.DB = oldDB
		_ = sqlDB.Close()
	})
}

func makeTestDeployment(revisionAnnotation string) *appsv1.Deployment {
	d := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo-app",
			Namespace: "default",
			UID:       deploymentTestUID,
		},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{"app": "demo-app"},
			},
		},
	}
	if revisionAnnotation != "" {
		d.Annotations = map[string]string{deploymentRevisionAnnotation: revisionAnnotation}
	}
	return d
}

func makeTestReplicaSet(name string, revision int64, changeCause, image string) *appsv1.ReplicaSet {
	isController := true
	replicas := int32(1)
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: "default",
			Labels:    map[string]string{"app": "demo-app"},
			Annotations: map[string]string{
				deploymentRevisionAnnotation: strconv.FormatInt(revision, 10),
			},
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: "apps/v1",
					Kind:       "Deployment",
					Name:       "demo-app",
					UID:        deploymentTestUID,
					Controller: &isController,
				},
			},
		},
		Spec: appsv1.ReplicaSetSpec{
			// kubectl's own rollback logic (k8s.io/kubectl/pkg/util/deployment)
			// dereferences Spec.Replicas directly, which the real API server
			// always defaults to non-nil; our raw fixture must too.
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "demo-app"}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "demo-app"}},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{Name: "nginx", Image: image}},
				},
			},
		},
	}
	if changeCause != "" {
		rs.Annotations[changeCauseAnnotation] = changeCause
	}
	return rs
}

func newDeploymentHandlerTestRouter(t *testing.T, cs *cluster.ClientSet) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	handler := NewDeploymentHandler()
	router := gin.New()
	router.GET("/deployments/:namespace/:name/revisions", func(c *gin.Context) {
		c.Set("cluster", cs)
		c.Set("user", model.User{Username: "alice"})
		handler.Revisions(c)
	})
	router.PUT("/deployments/:namespace/:name/rollback", func(c *gin.Context) {
		c.Set("cluster", cs)
		c.Set("user", model.User{Username: "alice"})
		handler.Rollback(c)
	})
	return router
}

func newWorkloadHandlerTestClientSet(t *testing.T, objs ...runtime.Object) *cluster.ClientSet {
	t.Helper()
	return &cluster.ClientSet{
		Name: "test",
		K8sClient: &kube.K8sClient{
			ClientSet: clientgofake.NewSimpleClientset(objs...),
		},
	}
}

func decodeRevisionsResponse(t *testing.T, rec *httptest.ResponseRecorder) []WorkloadRevisionItem {
	t.Helper()
	var body struct {
		Items []WorkloadRevisionItem `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, rec.Body.String())
	}
	return body.Items
}

func TestDeploymentHandlerRevisions_CurrentFollowsDeploymentAnnotation(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	// The Deployment's own bookkeeping says revision 2 is current, even though
	// a ReplicaSet with the numerically higher revision 3 also exists. The
	// "current" flag must follow the Deployment's annotation, not just pick
	// the highest revision number in the list.
	deployment := makeTestDeployment("2")
	rs1 := makeTestReplicaSet("demo-app-1", 1, "initial deploy", "nginx:1.25")
	rs2 := makeTestReplicaSet("demo-app-2", 2, "bump to 1.26", "nginx:1.26")
	rs3 := makeTestReplicaSet("demo-app-3", 3, "bump to 1.27", "nginx:1.27")

	cs := newWorkloadHandlerTestClientSet(t, deployment, rs1, rs2, rs3)
	router := newDeploymentHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/deployments/default/demo-app/revisions", nil)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	items := decodeRevisionsResponse(t, rec)
	if len(items) != 3 {
		t.Fatalf("expected 3 items, got %d", len(items))
	}

	// Sorted descending by revision.
	if items[0].Revision != 3 || items[1].Revision != 2 || items[2].Revision != 1 {
		t.Fatalf("unexpected revision order: %+v", items)
	}

	for _, item := range items {
		wantCurrent := item.Revision == 2
		if item.Current != wantCurrent {
			t.Errorf("revision %d: current=%v, want %v", item.Revision, item.Current, wantCurrent)
		}
	}
}

func TestDeploymentHandlerRevisions_FallsBackToHighestWhenAnnotationMissing(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	deployment := makeTestDeployment("")
	rs1 := makeTestReplicaSet("demo-app-1", 1, "", "nginx:1.25")
	rs2 := makeTestReplicaSet("demo-app-2", 2, "", "nginx:1.26")

	cs := newWorkloadHandlerTestClientSet(t, deployment, rs1, rs2)
	router := newDeploymentHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/deployments/default/demo-app/revisions", nil)
	router.ServeHTTP(rec, req)

	items := decodeRevisionsResponse(t, rec)
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}
	if !items[0].Current || items[0].Revision != 2 {
		t.Fatalf("expected highest revision (2) to be marked current, got %+v", items[0])
	}
	if items[1].Current {
		t.Fatalf("expected revision 1 to not be current: %+v", items[1])
	}
}

func TestDeploymentHandlerRevisions_SkipsMalformedRevisionAnnotation(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	deployment := makeTestDeployment("2")
	rs1 := makeTestReplicaSet("demo-app-1", 1, "initial deploy", "nginx:1.25")
	rs2 := makeTestReplicaSet("demo-app-2", 2, "bump to 1.26", "nginx:1.26")
	// A ReplicaSet with a non-numeric revision annotation must be excluded
	// entirely, not silently sorted/matched as revision 0.
	rsMalformed := makeTestReplicaSet("demo-app-bad", 0, "", "nginx:broken")
	rsMalformed.Annotations[deploymentRevisionAnnotation] = "not-a-number"

	cs := newWorkloadHandlerTestClientSet(t, deployment, rs1, rs2, rsMalformed)
	router := newDeploymentHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/deployments/default/demo-app/revisions", nil)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	items := decodeRevisionsResponse(t, rec)
	if len(items) != 2 {
		t.Fatalf("expected 2 items (malformed RS excluded), got %d: %+v", len(items), items)
	}
	for _, item := range items {
		if item.RevisionObject == "demo-app-bad" {
			t.Fatalf("malformed ReplicaSet should not appear in revisions: %+v", items)
		}
	}
}

func TestDeploymentHandlerRevisions_NotFound(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	cs := newWorkloadHandlerTestClientSet(t)
	router := newDeploymentHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/deployments/default/missing/revisions", nil)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestDeploymentHandlerRollback_ExplicitRevision(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	deployment := makeTestDeployment("3")
	rs1 := makeTestReplicaSet("demo-app-1", 1, "initial deploy", "nginx:1.25")
	rs2 := makeTestReplicaSet("demo-app-2", 2, "bump to 1.26", "nginx:1.26")
	rs3 := makeTestReplicaSet("demo-app-3", 3, "bump to 1.27", "nginx:1.27")

	cs := newWorkloadHandlerTestClientSet(t, deployment, rs1, rs2, rs3)
	router := newDeploymentHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/deployments/default/demo-app/rollback", strings.NewReader(`{"revision":1}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	updated, err := cs.K8sClient.ClientSet.AppsV1().Deployments("default").Get(t.Context(), "demo-app", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get updated deployment: %v", err)
	}
	if got := updated.Spec.Template.Spec.Containers[0].Image; got != "nginx:1.25" {
		t.Fatalf("expected rollback to revision 1's image nginx:1.25, got %s", got)
	}
}

func TestDeploymentHandlerRollback_NotFound(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	cs := newWorkloadHandlerTestClientSet(t)
	router := newDeploymentHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/deployments/default/missing/rollback", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestDeploymentHandlerRollback_DefaultRevision(t *testing.T) {
	tests := []struct {
		name              string
		currentAnnotation string
		wantImage         string
	}{
		{
			name:              "current matches the highest revision",
			currentAnnotation: "3",
			wantImage:         "nginx:1.26",
		},
		{
			// kubectl chooses the second-highest revision when no explicit
			// target is provided, regardless of the Deployment annotation.
			name:              "current lags behind the highest revision",
			currentAnnotation: "2",
			wantImage:         "nginx:1.26",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setupWorkloadHandlerTestDB(t)

			deployment := makeTestDeployment(tt.currentAnnotation)
			rs1 := makeTestReplicaSet("demo-app-1", 1, "initial deploy", "nginx:1.25")
			rs2 := makeTestReplicaSet("demo-app-2", 2, "bump to 1.26", "nginx:1.26")
			rs3 := makeTestReplicaSet("demo-app-3", 3, "bump to 1.27", "nginx:1.27")

			cs := newWorkloadHandlerTestClientSet(t, deployment, rs1, rs2, rs3)
			router := newDeploymentHandlerTestRouter(t, cs)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPut, "/deployments/default/demo-app/rollback", strings.NewReader("{}"))
			req.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
			}

			updated, err := cs.K8sClient.ClientSet.AppsV1().Deployments("default").Get(t.Context(), "demo-app", metav1.GetOptions{})
			if err != nil {
				t.Fatalf("get updated deployment: %v", err)
			}
			if got := updated.Spec.Template.Spec.Containers[0].Image; got != tt.wantImage {
				t.Fatalf("expected rollback image %s, got %s", tt.wantImage, got)
			}
		})
	}
}

func TestDeploymentHandlerRollback_RevisionNotFound(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	deployment := makeTestDeployment("2")
	rs1 := makeTestReplicaSet("demo-app-1", 1, "", "nginx:1.25")
	rs2 := makeTestReplicaSet("demo-app-2", 2, "", "nginx:1.26")

	cs := newWorkloadHandlerTestClientSet(t, deployment, rs1, rs2)
	router := newDeploymentHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/deployments/default/demo-app/rollback", strings.NewReader(`{"revision":99}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestDeploymentHandlerRollback_NoHistory(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	deployment := makeTestDeployment("")
	cs := newWorkloadHandlerTestClientSet(t, deployment)
	router := newDeploymentHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/deployments/default/demo-app/rollback", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}
