package resources

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/model"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
)

const statefulSetTestUID = types.UID("demo-statefulset-uid")

func makeTestStatefulSet(currentRevisionName string) *appsv1.StatefulSet {
	return &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo-sts",
			Namespace: "default",
			UID:       statefulSetTestUID,
		},
		Spec: appsv1.StatefulSetSpec{
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{"app": "demo-sts"},
			},
		},
		Status: appsv1.StatefulSetStatus{
			CurrentRevision: currentRevisionName,
		},
	}
}

func controllerRevisionData(t *testing.T, image string) runtime.RawExtension {
	t.Helper()
	doc := map[string]interface{}{
		"spec": map[string]interface{}{
			"template": map[string]interface{}{
				"$patch": "replace",
				"spec": map[string]interface{}{
					"containers": []map[string]interface{}{
						{"name": "nginx", "image": image},
					},
				},
			},
		},
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal controller revision data: %v", err)
	}
	return runtime.RawExtension{Raw: raw}
}

func makeTestControllerRevision(t *testing.T, name string, revision int64, changeCause, image string, ownerUID types.UID, ownerKind string) *appsv1.ControllerRevision {
	t.Helper()
	ownerName := "demo-sts"
	appLabel := "demo-sts"
	if ownerKind == "DaemonSet" {
		ownerName = "demo-ds"
		appLabel = "demo-ds"
	}
	isController := true
	cr := &appsv1.ControllerRevision{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: "default",
			Labels:    map[string]string{"app": appLabel},
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: "apps/v1",
					Kind:       ownerKind,
					Name:       ownerName,
					UID:        ownerUID,
					Controller: &isController,
				},
			},
		},
		Revision: revision,
		Data:     controllerRevisionData(t, image),
	}
	if changeCause != "" {
		cr.Annotations = map[string]string{changeCauseAnnotation: changeCause}
	}
	return cr
}

func newStatefulSetHandlerTestRouter(t *testing.T, cs *cluster.ClientSet) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	handler := NewStatefulSetHandler()
	router := gin.New()
	router.GET("/statefulsets/:namespace/:name/revisions", func(c *gin.Context) {
		c.Set("cluster", cs)
		c.Set("user", model.User{Username: "alice"})
		handler.Revisions(c)
	})
	router.PUT("/statefulsets/:namespace/:name/rollback", func(c *gin.Context) {
		c.Set("cluster", cs)
		c.Set("user", model.User{Username: "alice"})
		handler.Rollback(c)
	})
	return router
}

func TestStatefulSetHandlerRevisions_CurrentFollowsStatusUpdateRevision(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	// During a rollout, currentRevision still points to the old pods while
	// updateRevision identifies the desired revision from the StatefulSet spec.
	sts := makeTestStatefulSet("demo-sts-cr2")
	sts.Status.UpdateRevision = "demo-sts-cr3"
	cr1 := makeTestControllerRevision(t, "demo-sts-cr1", 1, "initial deploy", "nginx:1.25", statefulSetTestUID, "StatefulSet")
	cr2 := makeTestControllerRevision(t, "demo-sts-cr2", 2, "bump to 1.26", "nginx:1.26", statefulSetTestUID, "StatefulSet")
	cr3 := makeTestControllerRevision(t, "demo-sts-cr3", 3, "bump to 1.27", "nginx:1.27", statefulSetTestUID, "StatefulSet")

	cs := newWorkloadHandlerTestClientSet(t, sts, cr1, cr2, cr3)
	router := newStatefulSetHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/statefulsets/default/demo-sts/revisions", nil)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	items := decodeRevisionsResponse(t, rec)
	if len(items) != 3 {
		t.Fatalf("expected 3 items, got %d", len(items))
	}
	if items[0].Revision != 3 || items[1].Revision != 2 || items[2].Revision != 1 {
		t.Fatalf("unexpected revision order: %+v", items)
	}
	for _, item := range items {
		wantCurrent := item.Revision == 3
		if item.Current != wantCurrent {
			t.Errorf("revision %d: current=%v, want %v", item.Revision, item.Current, wantCurrent)
		}
		if item.Replicas != nil {
			t.Errorf("revision %d: expected no replicas field for StatefulSet revisions, got %v", item.Revision, *item.Replicas)
		}
	}
	if got := items[1].Images; len(got) != 1 || got[0] != "nginx:1.26" {
		t.Fatalf("expected images [nginx:1.26], got %v", got)
	}
}

func TestStatefulSetHandlerRevisions_FallsBackToHighestWhenCurrentRevisionEmpty(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	sts := makeTestStatefulSet("")
	cr1 := makeTestControllerRevision(t, "demo-sts-cr1", 1, "", "nginx:1.25", statefulSetTestUID, "StatefulSet")
	cr2 := makeTestControllerRevision(t, "demo-sts-cr2", 2, "", "nginx:1.26", statefulSetTestUID, "StatefulSet")

	cs := newWorkloadHandlerTestClientSet(t, sts, cr1, cr2)
	router := newStatefulSetHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/statefulsets/default/demo-sts/revisions", nil)
	router.ServeHTTP(rec, req)

	items := decodeRevisionsResponse(t, rec)
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}
	if !items[0].Current || items[0].Revision != 2 {
		t.Fatalf("expected highest revision (2) to be marked current, got %+v", items[0])
	}
}

func TestStatefulSetHandlerRevisions_NotFound(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	cs := newWorkloadHandlerTestClientSet(t)
	router := newStatefulSetHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/statefulsets/default/missing/revisions", nil)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestStatefulSetHandlerRollback_Revision(t *testing.T) {
	tests := []struct {
		name            string
		currentRevision string
		body            string
		wantImage       string
	}{
		{
			name:            "defaults to the previous revision",
			currentRevision: "demo-sts-cr2",
			body:            "{}",
			wantImage:       "nginx:1.26",
		},
		{
			name:            "uses the explicit revision",
			currentRevision: "demo-sts-cr3",
			body:            `{"revision":1}`,
			wantImage:       "nginx:1.25",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setupWorkloadHandlerTestDB(t)

			sts := makeTestStatefulSet(tt.currentRevision)
			cr1 := makeTestControllerRevision(t, "demo-sts-cr1", 1, "initial deploy", "nginx:1.25", statefulSetTestUID, "StatefulSet")
			cr2 := makeTestControllerRevision(t, "demo-sts-cr2", 2, "bump to 1.26", "nginx:1.26", statefulSetTestUID, "StatefulSet")
			cr3 := makeTestControllerRevision(t, "demo-sts-cr3", 3, "bump to 1.27", "nginx:1.27", statefulSetTestUID, "StatefulSet")

			cs := newWorkloadHandlerTestClientSet(t, sts, cr1, cr2, cr3)
			router := newStatefulSetHandlerTestRouter(t, cs)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPut, "/statefulsets/default/demo-sts/rollback", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
			}

			updated, err := cs.K8sClient.ClientSet.AppsV1().StatefulSets("default").Get(t.Context(), "demo-sts", metav1.GetOptions{})
			if err != nil {
				t.Fatalf("get updated statefulset: %v", err)
			}
			if got := updated.Spec.Template.Spec.Containers[0].Image; got != tt.wantImage {
				t.Fatalf("expected rollback image %s, got %s", tt.wantImage, got)
			}
		})
	}
}

func TestStatefulSetHandlerRollback_NotFound(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	cs := newWorkloadHandlerTestClientSet(t)
	router := newStatefulSetHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/statefulsets/default/missing/rollback", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestStatefulSetHandlerRollback_RevisionNotFound(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	sts := makeTestStatefulSet("demo-sts-cr2")
	cr1 := makeTestControllerRevision(t, "demo-sts-cr1", 1, "", "nginx:1.25", statefulSetTestUID, "StatefulSet")
	cr2 := makeTestControllerRevision(t, "demo-sts-cr2", 2, "", "nginx:1.26", statefulSetTestUID, "StatefulSet")

	cs := newWorkloadHandlerTestClientSet(t, sts, cr1, cr2)
	router := newStatefulSetHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/statefulsets/default/demo-sts/rollback", strings.NewReader(`{"revision":99}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestStatefulSetHandlerRollback_NoHistory(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	sts := makeTestStatefulSet("")
	cs := newWorkloadHandlerTestClientSet(t, sts)
	router := newStatefulSetHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/statefulsets/default/demo-sts/rollback", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}
