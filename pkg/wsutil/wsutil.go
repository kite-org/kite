package wsutil

import (
	"context"
	"net/http"

	"golang.org/x/net/websocket"
	"k8s.io/klog/v2"
)

type Message struct {
	Type string `json:"type"`
	Data string `json:"data"`
}

type Session struct {
	Context context.Context
	Conn    *websocket.Conn
}

func Serve(w http.ResponseWriter, r *http.Request, handle func(*Session)) {
	websocket.Handler(func(conn *websocket.Conn) {
		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		handle(&Session{
			Context: ctx,
			Conn:    conn,
		})
	}).ServeHTTP(w, r)
}

func SendMessage(conn *websocket.Conn, msgType, data string) error {
	return websocket.JSON.Send(conn, Message{Type: msgType, Data: data})
}

func SendError(conn *websocket.Conn, message string) error {
	return SendMessage(conn, "error", message)
}

func SendErrorMessage(conn *websocket.Conn, message string) {
	if err := SendError(conn, message); err != nil {
		klog.Errorf("Failed to send error message: %v", err)
	}
}

func (s *Session) SendMessage(msgType, data string) error {
	return SendMessage(s.Conn, msgType, data)
}

func (s *Session) SendErrorMessage(message string) {
	SendErrorMessage(s.Conn, message)
}

func (s *Session) Close() {
	if err := s.Conn.Close(); err != nil {
		klog.Errorf("WebSocket close error %s: %v", s.Conn.RemoteAddr(), err)
	}
}
