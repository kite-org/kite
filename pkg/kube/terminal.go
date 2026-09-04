package kube

import (
	"context"
	"fmt"
	"log"

	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/wsutil"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"
	"k8s.io/klog/v2"
)

const EndOfTransmission = "\u0004"

// TerminalMessage represents messages sent over the WebSocket
type TerminalMessage struct {
	Type string `json:"type"`
	Data string `json:"data"`
	Rows uint16 `json:"rows,omitempty"`
	Cols uint16 `json:"cols,omitempty"`
}

// TerminalSession manages a WebSocket connection for terminal communication
type TerminalSession struct {
	k8sClient *K8sClient
	conn      *wsutil.Conn
	sizeChan  chan *remotecommand.TerminalSize
	namespace string
	podName   string
	container string
	cancel    context.CancelFunc
}

func NewTerminalSession(client *K8sClient, conn *wsutil.Conn, namespace, podName, container string) *TerminalSession {
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
	attach := subResource == "attach"
	if attach {
		ctx, session.cancel = context.WithCancel(ctx)
		defer session.cancel()
	}
	req := session.k8sClient.ClientSet.CoreV1().RESTClient().Post().
		Resource(string(common.Pods)).
		Name(session.podName).
		Namespace(session.namespace).
		SubResource(subResource)

	if attach {
		req.VersionedParams(&corev1.PodAttachOptions{
			Container: session.container,
			Stdin:     true,
			Stdout:    true,
			Stderr:    true,
			TTY:       true,
		}, scheme.ParameterCodec)
	} else {
		req.VersionedParams(&corev1.PodExecOptions{
			Container: session.container,
			Command:   []string{"sh", "-c", "bash || sh"},
			Stdin:     true,
			Stdout:    true,
			Stderr:    true,
			TTY:       true,
		}, scheme.ParameterCodec)
	}

	exec, err := newRemoteCommandExecutor(session.k8sClient.Configuration, req.URL())
	if err != nil {
		log.Printf("Failed to create executor: %v", err)
		session.SendErrorMessage(fmt.Sprintf("Failed to create executor: %v", err))
		return err
	}

	// Send initial connection success message
	session.SendMessage("connected", "Terminal connected successfully")

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
	close(session.sizeChan)
}

func (session *TerminalSession) Read(p []byte) (int, error) {
	var msg TerminalMessage
	err := session.conn.ReadJSON(&msg)
	if err != nil {
		if session.cancel != nil {
			session.cancel()
			return 0, err
		}
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
	default:
		return copy(p, EndOfTransmission), fmt.Errorf("unknown message type: %s", msg.Type)
	}
	return 0, nil
}

func (session *TerminalSession) Write(p []byte) (int, error) {
	err := wsutil.SendMessage(session.conn, "stdout", string(p))
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
	if err := wsutil.SendMessage(session.conn, msgType, data); err != nil {
		klog.Errorf("Send message error: %v", err)
	}
}

func (session *TerminalSession) SendErrorMessage(errMsg string) {
	wsutil.SendErrorMessage(session.conn, errMsg)
}
