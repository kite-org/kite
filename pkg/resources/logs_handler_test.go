package resources

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/wsutil"
)

func TestLogsWebSocketEnforcesRBACAndValidatesOptions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	clientSet := &cluster.ClientSet{Name: "prod", K8sClient: &kube.K8sClient{}}
	handler := &LogsHandler{}
	router := gin.New()
	router.GET("/unauthorized/:namespace/:podName", func(c *gin.Context) {
		c.Set("cluster", clientSet)
		c.Set("user", model.User{Username: "alice"})
		handler.HandleLogsWebSocket(c)
	})
	router.GET("/authorized/:namespace/:podName", func(c *gin.Context) {
		c.Set("cluster", clientSet)
		c.Set("user", model.User{Username: "alice", Roles: []common.Role{{
			Name:       "log-reader",
			Clusters:   []string{"prod"},
			Namespaces: []string{"default"},
			Resources:  []string{"pods"},
			Verbs:      []string{"log"},
		}}})
		handler.HandleLogsWebSocket(c)
	})
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)

	tests := []struct {
		path        string
		wantMessage string
	}{
		{"/unauthorized/default/web", "does not have permission to log pods"},
		{"/authorized/default/web?tailLines=invalid", "invalid tailLines parameter"},
		{"/authorized/default/web?sinceSeconds=invalid", "invalid sinceSeconds parameter"},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			url := "ws" + strings.TrimPrefix(server.URL, "http") + tt.path
			conn, response, err := websocket.DefaultDialer.Dial(url, nil)
			if response != nil {
				defer func() {
					_ = response.Body.Close()
				}()
			}
			if err != nil {
				if response != nil {
					t.Fatalf("dialing WebSocket: %v, status=%d", err, response.StatusCode)
				}
				t.Fatalf("dialing WebSocket: %v", err)
			}
			defer func() {
				_ = conn.Close()
			}()
			var message wsutil.Message
			if err := conn.ReadJSON(&message); err != nil {
				t.Fatalf("reading error message: %v", err)
			}
			if message.Type != "error" || !strings.Contains(message.Data, tt.wantMessage) {
				t.Fatalf("message = %#v", message)
			}
		})
	}
}
