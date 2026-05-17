package terminal

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"github.com/zxh326/kite/pkg/wsutil"
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

	wsutil.Serve(c.Writer, c.Request, func(ws *wsutil.Session) {
		session := kube.NewTerminalSession(cs.K8sClient, ws.Conn, namespace, podName, container)
		defer session.Close()

		if !rbac.CanAccess(user, string(common.Pods), "exec", cs.Name, namespace) {
			ws.SendErrorMessage(
				rbac.NoAccess(user.Key(), string(common.VerbExec), string(common.Pods), namespace, cs.Name),
			)
			return
		}

		if err := session.Start(ws.Context, "exec"); err != nil {
			klog.Errorf("Terminal session error: %v", err)
		}
	})
}
