package resources

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/model"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

const daemonSetTestUID = types.UID("demo-daemonset-uid")

func makeTestDaemonSet() *appsv1.DaemonSet {
	return &appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo-ds",
			Namespace: "default",
			UID:       daemonSetTestUID,
		},
		Spec: appsv1.DaemonSetSpec{
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{"app": "demo-ds"},
			},
		},
	}
}

func newDaemonSetHandlerTestRouter(t *testing.T, cs *cluster.ClientSet) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	handler := NewDaemonSetHandler()
	router := gin.New()
	router.GET("/daemonsets/:namespace/:name/revisions", func(c *gin.Context) {
		c.Set("cluster", cs)
		c.Set("user", model.User{Username: "alice"})
		handler.Revisions(c)
	})
	router.PUT("/daemonsets/:namespace/:name/rollback", func(c *gin.Context) {
		c.Set("cluster", cs)
		c.Set("user", model.User{Username: "alice"})
		handler.Rollback(c)
	})
	return router
}

func TestDaemonSetHandlerRevisions_CurrentIsHighestRevision(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	ds := makeTestDaemonSet()
	cr1 := makeTestControllerRevision(t, "demo-ds-cr1", 1, "initial deploy", "fluentd:1.14", daemonSetTestUID, "DaemonSet")
	cr2 := makeTestControllerRevision(t, "demo-ds-cr2", 2, "bump to 1.15", "fluentd:1.15", daemonSetTestUID, "DaemonSet")

	cs := newWorkloadHandlerTestClientSet(t, ds, cr1, cr2)
	router := newDaemonSetHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/daemonsets/default/demo-ds/revisions", nil)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	items := decodeRevisionsResponse(t, rec)
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}
	if items[0].Revision != 2 || !items[0].Current {
		t.Fatalf("expected highest revision (2) to be current, got %+v", items[0])
	}
	if items[1].Current {
		t.Fatalf("expected revision 1 to not be current: %+v", items[1])
	}
	if got := items[0].Images; len(got) != 1 || got[0] != "fluentd:1.15" {
		t.Fatalf("expected images [fluentd:1.15], got %v", got)
	}
}

func TestDaemonSetHandlerRevisions_NotFound(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	cs := newWorkloadHandlerTestClientSet(t)
	router := newDaemonSetHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/daemonsets/default/missing/revisions", nil)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestDaemonSetHandlerRollback_Revision covers both the default (no
// explicit revision, "{}") and explicit-revision rollback request shapes.
func TestDaemonSetHandlerRollback_Revision(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{
			name: "defaults to the previous revision",
			body: "{}",
		},
		{
			name: "uses the explicit revision",
			body: `{"revision":1}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setupWorkloadHandlerTestDB(t)

			ds := makeTestDaemonSet()
			cr1 := makeTestControllerRevision(t, "demo-ds-cr1", 1, "initial deploy", "fluentd:1.14", daemonSetTestUID, "DaemonSet")
			cr2 := makeTestControllerRevision(t, "demo-ds-cr2", 2, "bump to 1.15", "fluentd:1.15", daemonSetTestUID, "DaemonSet")

			cs := newWorkloadHandlerTestClientSet(t, ds, cr1, cr2)
			router := newDaemonSetHandlerTestRouter(t, cs)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPut, "/daemonsets/default/demo-ds/rollback", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
			}

			updated, err := cs.K8sClient.ClientSet.AppsV1().DaemonSets("default").Get(t.Context(), "demo-ds", metav1.GetOptions{})
			if err != nil {
				t.Fatalf("get updated daemonset: %v", err)
			}
			if got := updated.Spec.Template.Spec.Containers[0].Image; got != "fluentd:1.14" {
				t.Fatalf("expected rollback to revision 1's image fluentd:1.14, got %s", got)
			}
		})
	}
}

func TestDaemonSetHandlerRollback_NotFound(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	cs := newWorkloadHandlerTestClientSet(t)
	router := newDaemonSetHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/daemonsets/default/missing/rollback", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestDaemonSetHandlerRollback_RevisionNotFound(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	ds := makeTestDaemonSet()
	cr1 := makeTestControllerRevision(t, "demo-ds-cr1", 1, "", "fluentd:1.14", daemonSetTestUID, "DaemonSet")
	cr2 := makeTestControllerRevision(t, "demo-ds-cr2", 2, "", "fluentd:1.15", daemonSetTestUID, "DaemonSet")

	cs := newWorkloadHandlerTestClientSet(t, ds, cr1, cr2)
	router := newDaemonSetHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/daemonsets/default/demo-ds/rollback", strings.NewReader(`{"revision":99}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestDaemonSetHandlerRollback_NoHistory(t *testing.T) {
	setupWorkloadHandlerTestDB(t)

	ds := makeTestDaemonSet()
	cs := newWorkloadHandlerTestClientSet(t, ds)
	router := newDaemonSetHandlerTestRouter(t, cs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/daemonsets/default/demo-ds/rollback", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}
