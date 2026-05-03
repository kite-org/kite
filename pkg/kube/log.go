package kube

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"

	"golang.org/x/net/websocket"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/klog/v2"
)

type PodLogStream struct {
	Pod    corev1.Pod
	Cancel context.CancelFunc
	Done   chan struct{}
}

type BatchLogHandler struct {
	conn      *websocket.Conn
	mu        sync.RWMutex
	pods      map[string]*PodLogStream // key: namespace/name; guarded by mu
	k8sClient *K8sClient
	opts      *corev1.PodLogOptions
	ctx       context.Context
	cancel    context.CancelFunc
}

func NewBatchLogHandler(conn *websocket.Conn, client *K8sClient, opts *corev1.PodLogOptions) *BatchLogHandler {
	ctx, cancel := context.WithCancel(context.Background())
	l := &BatchLogHandler{
		conn:      conn,
		pods:      make(map[string]*PodLogStream),
		k8sClient: client,
		opts:      opts,
		ctx:       ctx,
		cancel:    cancel,
	}
	return l
}

func (l *BatchLogHandler) StreamLogs(ctx context.Context) {
	// Start heartbeat handler
	go l.heartbeat(ctx)

	// Wait for either external context cancellation or internal cancellation
	select {
	case <-ctx.Done():
		klog.V(1).Info("External context cancelled, stopping BatchLogHandler")
	case <-l.ctx.Done():
		klog.V(1).Info("Internal context cancelled, stopping BatchLogHandler")
	}

	l.Stop()
}

func (l *BatchLogHandler) startPodLogStream(podStream *PodLogStream) {
	pod := podStream.Pod
	podCtx, cancel := context.WithCancel(l.ctx)
	podStream.Cancel = cancel

	defer func() {
		close(podStream.Done)
	}()

	req := l.k8sClient.ClientSet.CoreV1().Pods(pod.Namespace).GetLogs(pod.Name, l.opts)
	podLogs, err := req.Stream(podCtx)
	if err != nil {
		_ = sendErrorMessage(l.conn, fmt.Sprintf("Failed to get pod logs for %s: %v", pod.Name, err))
		return
	}
	defer func() {
		_ = podLogs.Close()
	}()

	var pendingLine bytes.Buffer
	sendLogLine := func(line string) error {
		if line == "" {
			return nil
		}

		l.mu.RLock()
		multiPod := len(l.pods) > 1
		l.mu.RUnlock()

		if multiPod {
			line = fmt.Sprintf("[%s]: %s", pod.Name, line)
		}

		return sendMessage(l.conn, "log", line)
	}

	lw := writerFunc(func(p []byte) (int, error) {
		n := len(p)
		for len(p) > 0 {
			newlineIndex := bytes.IndexByte(p, '\n')
			if newlineIndex < 0 {
				_, _ = pendingLine.Write(p)
				return n, nil
			}

			if pendingLine.Len() == 0 {
				if err := sendLogLine(string(p[:newlineIndex])); err != nil {
					return 0, err
				}
			} else {
				_, _ = pendingLine.Write(p[:newlineIndex])
				if err := sendLogLine(pendingLine.String()); err != nil {
					return 0, err
				}
				pendingLine.Reset()
			}

			p = p[newlineIndex+1:]
		}

		return n, nil
	})

	_, err = io.Copy(lw, podLogs)
	if err == nil && pendingLine.Len() > 0 {
		err = sendLogLine(pendingLine.String())
	}
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, context.Canceled) {
		_ = sendErrorMessage(l.conn, fmt.Sprintf("Failed to stream pod logs for %s: %v", pod.Name, err))
	}

	_ = sendMessage(l.conn, "close", fmt.Sprintf("{\"status\":\"closed\",\"pod\":\"%s\"}", pod.Name))
}

func (l *BatchLogHandler) heartbeat(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			klog.Info("Heartbeat stopping due to context cancellation")
			return
		case <-l.ctx.Done():
			klog.Info("Heartbeat stopping due to internal context cancellation")
			return
		default:
			var temp []byte
			err := websocket.Message.Receive(l.conn, &temp)
			if err != nil {
				if !errors.Is(err, io.EOF) {
					klog.Errorf("WebSocket connection error in heartbeat, cancelling internal context: %v", err)
				}
				l.cancel() // Cancel internal context when connection is lost
				return
			}
			if strings.Contains(string(temp), "ping") {
				err = sendMessage(l.conn, "pong", "pong")
				if err != nil {
					klog.Infof("Failed to send pong, cancelling internal context: %v", err)
					l.cancel() // Cancel internal context when send fails
					return
				}
			}
		}
	}
}

// AddPod adds a new pod to the batch log handler and starts streaming its logs
func (l *BatchLogHandler) AddPod(pod corev1.Pod) {
	key := fmt.Sprintf("%s/%s", pod.Namespace, pod.Name)

	l.mu.Lock()
	if _, exists := l.pods[key]; exists {
		l.mu.Unlock()
		return
	}

	podStream := &PodLogStream{
		Pod:  pod,
		Done: make(chan struct{}),
	}
	l.pods[key] = podStream
	l.mu.Unlock()

	// Start streaming for this pod
	go l.startPodLogStream(podStream)

	_ = sendMessage(l.conn, "pod_added", fmt.Sprintf("{\"pod\":\"%s\",\"namespace\":\"%s\"}",
		pod.Name, pod.Namespace))
}

// RemovePod removes a pod from the batch log handler and stops streaming its logs
func (l *BatchLogHandler) RemovePod(pod corev1.Pod) {
	key := fmt.Sprintf("%s/%s", pod.Namespace, pod.Name)

	l.mu.Lock()
	podStream, exists := l.pods[key]
	if !exists {
		l.mu.Unlock()
		return
	}
	delete(l.pods, key)
	l.mu.Unlock()

	if podStream.Cancel != nil {
		podStream.Cancel()
	}

	go func() {
		<-podStream.Done
		_ = sendMessage(l.conn, "pod_removed", fmt.Sprintf("{\"pod\":\"%s\",\"namespace\":\"%s\"}",
			pod.Name, pod.Namespace))
	}()
}

func (l *BatchLogHandler) Stop() {
	l.mu.Lock()
	for _, podStream := range l.pods {
		if podStream.Cancel != nil {
			podStream.Cancel()
		}
	}
	l.pods = make(map[string]*PodLogStream)
	l.mu.Unlock()
	l.cancel()
}

// writerFunc adapts a function to io.Writer so we can create
// small writers inline inside functions and capture local state.
type writerFunc func([]byte) (int, error)

func (wf writerFunc) Write(p []byte) (int, error) {
	return wf(p)
}

type LogsMessage struct {
	Type string `json:"type"` // "log", "error", "connected", "close"
	Data string `json:"data"`
}

func sendMessage(ws *websocket.Conn, msgType, data string) error {
	msg := LogsMessage{
		Type: msgType,
		Data: data,
	}
	if err := websocket.JSON.Send(ws, msg); err != nil {
		return err
	}
	return nil
}

func sendErrorMessage(ws *websocket.Conn, errMsg string) error {
	return sendMessage(ws, "error", errMsg)
}
