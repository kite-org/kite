package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/model"
)

func TestHandleProxyRejectsInvalidKindAndUnauthorizedAccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := &ProxyHandler{}
	router := gin.New()
	router.GET("/namespaces/:namespace/:kind/:name/proxy/*path", func(c *gin.Context) {
		c.Set("cluster", &cluster.ClientSet{Name: "prod"})
		c.Set("user", model.User{Username: "alice"})
		handler.HandleProxy(c)
	})

	tests := []struct {
		path       string
		wantStatus int
	}{
		{"/namespaces/default/deployments/web/proxy/health", http.StatusBadRequest},
		{"/namespaces/default/pods/web/proxy/health", http.StatusForbidden},
		{"/namespaces/default/services/web/proxy/health", http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, tt.path, nil)
			router.ServeHTTP(recorder, request)
			if recorder.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d: %s", recorder.Code, tt.wantStatus, recorder.Body.String())
			}
		})
	}
}
