package wsutil

import (
	"golang.org/x/net/websocket"
	"k8s.io/klog/v2"
)

type Message struct {
	Type string `json:"type"`
	Data string `json:"data"`
}

func SendMessage(conn *websocket.Conn, msgType, data string) error {
	return websocket.JSON.Send(conn, Message{Type: msgType, Data: data})
}

func SendErrorMessage(conn *websocket.Conn, message string) {
	if err := SendMessage(conn, "error", message); err != nil {
		klog.Errorf("Failed to send error message: %v", err)
	}
}
