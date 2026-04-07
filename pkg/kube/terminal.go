package kube

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/zxh326/kite/pkg/common"
	"golang.org/x/net/websocket"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"
	"k8s.io/klog/v2"
)

const EndOfTransmission = "\u0004"

// TerminalMessage represents messages sent over the WebSocket
type TerminalMessage struct {
	Type string `json:"type"` // "stdin", "resize", "ping"
	Data string `json:"data"`
	Rows uint16 `json:"rows,omitempty"`
	Cols uint16 `json:"cols,omitempty"`
}

// TerminalSession manages a WebSocket connection for terminal communication
type TerminalSession struct {
	k8sClient *K8sClient
	conn      *websocket.Conn
	sizeChan  chan *remotecommand.TerminalSize
	namespace string
	podName   string
	container string

	lastHeartbeat time.Time // Track last heartbeat for ping/pong
}

func NewTerminalSession(client *K8sClient, conn *websocket.Conn, namespace, podName, container string) *TerminalSession {
	return &TerminalSession{
		k8sClient: client,
		conn:      conn,
		sizeChan:  make(chan *remotecommand.TerminalSize, 10),
		namespace: namespace,
		podName:   podName,
		container: container,
	}
}

func (session *TerminalSession) Start(ctx context.Context, subResource string) error {
	req := session.k8sClient.ClientSet.CoreV1().RESTClient().Post().
		Resource(string(common.Pods)).
		Name(session.podName).
		Namespace(session.namespace).
		SubResource(subResource)

	// Set up exec parameters
	req.VersionedParams(&corev1.PodExecOptions{
		Container: session.container,
		Command:   []string{"sh", "-c", "bash || sh"},
		Stdin:     true,
		Stdout:    true,
		Stderr:    true,
		TTY:       true,
	}, scheme.ParameterCodec)

	// TODO: use NewWebSocketExecutor
	exec, err := remotecommand.NewSPDYExecutor(session.k8sClient.Configuration, "POST", req.URL())

	if err != nil {
		log.Printf("Failed to create executor: %v", err)
		session.SendErrorMessage(fmt.Sprintf("Failed to create executor: %v", err))
		return err
	}

	// Send initial connection success message
	session.SendMessage("connected", "Terminal connected successfully")

	go session.checkHeartbeat(ctx)
	// Start the exec session
	err = exec.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin:             session,
		Stdout:            session,
		Stderr:            session,
		Tty:               true,
		TerminalSizeQueue: session,
	})

	if err != nil {
		session.SendErrorMessage(err.Error())
		return err
	}

	return nil
}

func (session *TerminalSession) Close() {
	if err := session.conn.Close(); err != nil {
		klog.Errorf("WebSocket close error %s: %v", session.conn.RemoteAddr(), err)
	}
	close(session.sizeChan)
}

func (session *TerminalSession) Read(p []byte) (int, error) {
	var msg TerminalMessage
	err := websocket.JSON.Receive(session.conn, &msg)
	if err != nil {
		return copy(p, EndOfTransmission), err
	}

	switch msg.Type {
	case "stdin":
		data := []byte(msg.Data)
		return copy(p, data), nil
	case "resize":
		if msg.Rows > 0 && msg.Cols > 0 {
			select {
			case session.sizeChan <- &remotecommand.TerminalSize{
				Width:  msg.Cols,
				Height: msg.Rows,
			}:
			default:
			}
		}
	case "ping":
		session.lastHeartbeat = time.Now()
		session.SendMessage("pong", "")
	default:
		return copy(p, EndOfTransmission), fmt.Errorf("unknown message type: %s", msg.Type)
	}
	return 0, nil
}

func (session *TerminalSession) Write(p []byte) (int, error) {
	msg := TerminalMessage{
		Type: "stdout",
		Data: string(p),
	}
	err := websocket.JSON.Send(session.conn, msg)
	if err != nil {
		log.Printf("Write stdout error: %v", err)
		return 0, err
	}
	return len(p), nil
}

func (session *TerminalSession) Next() *remotecommand.TerminalSize {
	return <-session.sizeChan
}

func (session *TerminalSession) SendMessage(msgType, data string) {
	msg := TerminalMessage{
		Type: msgType,
		Data: data,
	}
	err := websocket.JSON.Send(session.conn, msg)
	if err != nil {
		klog.Errorf("Send message error: %v", err)
	}
}

func (session *TerminalSession) SendErrorMessage(errMsg string) {
	session.SendMessage("error", errMsg)
}

func (session *TerminalSession) checkHeartbeat(ctx context.Context) {
	session.lastHeartbeat = time.Now()
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if time.Since(session.lastHeartbeat) > 1*time.Minute {
				if err := session.conn.Close(); err != nil {
					klog.Errorf("WebSocket close error: %v", err)
				}
				return
			}
		}
	}
}
