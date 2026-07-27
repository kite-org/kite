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
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

const deploymentTestUID = types.UID("demo-deployment-uid")

func setupDeploymentHandlerTestDB(t *testing.T) {
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
		rs.Annotations[deploymentChangeCauseAnnotation] = changeCause
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

func newDeploymentHandlerTestClientSet(t *testing.T, objs ...client.Object) *cluster.ClientSet {
	t.Helper()
	scheme := runtime.NewScheme()
	if err := appsv1.AddToScheme(scheme); err != nil {
		t.Fatal(err)
	}
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatal(err)
	}
	fakeClient := fake.NewClientBuilder().WithScheme(scheme).WithObjects(objs...).Build()
	return &cluster.ClientSet{
		Name:      "test",
		K8sClient: &kube.K8sClient{Client: fakeClient},
	}
}

func decodeRevisionsResponse(t *testing.T, rec *httptest.ResponseRecorder) []deploymentRevisionItem {
	t.Helper()
	var body struct {
		Items []deploymentRevisionItem `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, rec.Body.String())
	}
	return body.Items
}

func TestDeploymentHandlerRevisions_CurrentFollowsDeploymentAnnotation(t *testing.T) {
	setupDeploymentHandlerTestDB(t)

	// The Deployment's own bookkeeping says revision 2 is current, even though
	// a ReplicaSet with the numerically higher revision 3 also exists. The
	// "current" flag must follow the Deployment's annotation, not just pick
	// the highest revision number in the list.
	deployment := makeTestDeployment("2")
	rs1 := makeTestReplicaSet("demo-app-1", 1, "initial deploy", "nginx:1.25")
	rs2 := makeTestReplicaSet("demo-app-2", 2, "bump to 1.26", "nginx:1.26")
	rs3 := makeTestReplicaSet("demo-app-3", 3, "bump to 1.27", "nginx:1.27")

	cs := newDeploymentHandlerTestClientSet(t, deployment, rs1, rs2, rs3)
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
	setupDeploymentHandlerTestDB(t)

	deployment := makeTestDeployment("")
	rs1 := makeTestReplicaSet("demo-app-1", 1, "", "nginx:1.25")
	rs2 := makeTestReplicaSet("demo-app-2", 2, "", "nginx:1.26")

	cs := newDeploymentHandlerTestClientSet(t, deployment, rs1, rs2)
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

func TestDeploymentHandlerRevisions_NotFound(t *testing.T) {
	setupDeploymentHandlerTestDB(t)

	cs := newDeploymentHandlerTestClientSet(t)
	router := newDeploymentHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/deployments/default/missing/revisions", nil)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestDeploymentHandlerRollback_DefaultsToPreviousRevision(t *testing.T) {
	setupDeploymentHandlerTestDB(t)

	deployment := makeTestDeployment("3")
	rs1 := makeTestReplicaSet("demo-app-1", 1, "initial deploy", "nginx:1.25")
	rs2 := makeTestReplicaSet("demo-app-2", 2, "bump to 1.26", "nginx:1.26")
	rs3 := makeTestReplicaSet("demo-app-3", 3, "bump to 1.27", "nginx:1.27")

	cs := newDeploymentHandlerTestClientSet(t, deployment, rs1, rs2, rs3)
	router := newDeploymentHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/deployments/default/demo-app/rollback", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var updated appsv1.Deployment
	if err := cs.K8sClient.Get(t.Context(), types.NamespacedName{Namespace: "default", Name: "demo-app"}, &updated); err != nil {
		t.Fatalf("get updated deployment: %v", err)
	}
	if got := updated.Spec.Template.Spec.Containers[0].Image; got != "nginx:1.26" {
		t.Fatalf("expected rollback to revision 2's image nginx:1.26, got %s", got)
	}
}

func TestDeploymentHandlerRollback_ExplicitRevision(t *testing.T) {
	setupDeploymentHandlerTestDB(t)

	deployment := makeTestDeployment("3")
	rs1 := makeTestReplicaSet("demo-app-1", 1, "initial deploy", "nginx:1.25")
	rs2 := makeTestReplicaSet("demo-app-2", 2, "bump to 1.26", "nginx:1.26")
	rs3 := makeTestReplicaSet("demo-app-3", 3, "bump to 1.27", "nginx:1.27")

	cs := newDeploymentHandlerTestClientSet(t, deployment, rs1, rs2, rs3)
	router := newDeploymentHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/deployments/default/demo-app/rollback", strings.NewReader(`{"revision":1}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var updated appsv1.Deployment
	if err := cs.K8sClient.Get(t.Context(), types.NamespacedName{Namespace: "default", Name: "demo-app"}, &updated); err != nil {
		t.Fatalf("get updated deployment: %v", err)
	}
	if got := updated.Spec.Template.Spec.Containers[0].Image; got != "nginx:1.25" {
		t.Fatalf("expected rollback to revision 1's image nginx:1.25, got %s", got)
	}
	if got := updated.Annotations[deploymentChangeCauseAnnotation]; got != "Rolled back to revision 1 via Kite" {
		t.Fatalf("unexpected change-cause annotation: %s", got)
	}
}

func TestDeploymentHandlerRollback_NotFound(t *testing.T) {
	setupDeploymentHandlerTestDB(t)

	cs := newDeploymentHandlerTestClientSet(t)
	router := newDeploymentHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/deployments/default/missing/rollback", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestDeploymentHandlerRollback_DefaultUsesRevisionBeforeCurrentAnnotation covers
// the case where the Deployment's own revision annotation does not point at the
// highest-numbered ReplicaSet (e.g. it lags behind due to eventual consistency, or
// a stale RS was left with a higher revision number). The default rollback target
// must be the revision immediately before the Deployment's *actual* current
// revision, not just replicaSets[1] in sorted order.
func TestDeploymentHandlerRollback_DefaultUsesRevisionBeforeCurrentAnnotation(t *testing.T) {
	setupDeploymentHandlerTestDB(t)

	// Deployment says its current revision is 2, but a ReplicaSet with the
	// numerically higher revision 3 also exists (e.g. stale/orphaned).
	deployment := makeTestDeployment("2")
	rs1 := makeTestReplicaSet("demo-app-1", 1, "initial deploy", "nginx:1.25")
	rs2 := makeTestReplicaSet("demo-app-2", 2, "bump to 1.26", "nginx:1.26")
	rs3 := makeTestReplicaSet("demo-app-3", 3, "bump to 1.27", "nginx:1.27")

	cs := newDeploymentHandlerTestClientSet(t, deployment, rs1, rs2, rs3)
	router := newDeploymentHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/deployments/default/demo-app/rollback", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var updated appsv1.Deployment
	if err := cs.K8sClient.Get(t.Context(), types.NamespacedName{Namespace: "default", Name: "demo-app"}, &updated); err != nil {
		t.Fatalf("get updated deployment: %v", err)
	}
	// The revision before the *current* revision (2) is 1, not the RS after
	// index 1 in the sorted list (which would have picked revision 2 itself).
	if got := updated.Spec.Template.Spec.Containers[0].Image; got != "nginx:1.25" {
		t.Fatalf("expected rollback to revision 1's image nginx:1.25, got %s", got)
	}
}

func TestDeploymentHandlerRollback_RevisionNotFound(t *testing.T) {
	setupDeploymentHandlerTestDB(t)

	deployment := makeTestDeployment("2")
	rs1 := makeTestReplicaSet("demo-app-1", 1, "", "nginx:1.25")
	rs2 := makeTestReplicaSet("demo-app-2", 2, "", "nginx:1.26")

	cs := newDeploymentHandlerTestClientSet(t, deployment, rs1, rs2)
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
	setupDeploymentHandlerTestDB(t)

	deployment := makeTestDeployment("")
	cs := newDeploymentHandlerTestClientSet(t, deployment)
	router := newDeploymentHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/deployments/default/demo-app/rollback", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}
