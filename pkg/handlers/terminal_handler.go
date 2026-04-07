package handlers

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/handlers/wsutil"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"golang.org/x/net/websocket"
	"k8s.io/klog/v2"
)

type TerminalHandler struct {
}

func NewTerminalHandler() *TerminalHandler {
	return &TerminalHandler{}
}

// HandleTerminalWebSocket handles WebSocket connections for terminal sessions
func (h *TerminalHandler) HandleTerminalWebSocket(c *gin.Context) {
	// Get cluster info from context
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	// Get path parameters
	namespace := c.Param("namespace")
	podName := c.Param("podName")
	container := c.Query("container")

	if namespace == "" || podName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "namespace and podName are required"})
		return
	}

	user := c.MustGet("user").(model.User)

	websocket.Handler(func(ws *websocket.Conn) {
		ctx, cancel := context.WithCancel(c.Request.Context())
		defer cancel()
		session := kube.NewTerminalSession(cs.K8sClient, ws, namespace, podName, container)
		defer session.Close()

		if !rbac.CanAccess(user, string(common.Pods), "exec", cs.Name, namespace) {
			wsutil.SendErrorMessage(
				ws,
				rbac.NoAccess(user.Key(), string(common.VerbExec), string(common.Pods), namespace, cs.Name),
			)
			return
		}

		if err := session.Start(ctx, "exec"); err != nil {
			klog.Errorf("Terminal session error: %v", err)
		}
	}).ServeHTTP(c.Writer, c.Request)
}
