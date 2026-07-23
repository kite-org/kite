package wsutil

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gorilla/websocket"
)

func TestServeSerializesConcurrentMessages(t *testing.T) {
	const messageCount = 20
	serverErrors := make(chan error, messageCount)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		Serve(w, r, func(session *Session) {
			var wait sync.WaitGroup
			for i := 0; i < messageCount; i++ {
				wait.Add(1)
				go func(index int) {
					defer wait.Done()
					if err := session.SendMessage("stdout", fmt.Sprintf("message-%d", index)); err != nil {
						serverErrors <- err
					}
				}(i)
			}
			wait.Wait()
		})
	}))
	t.Cleanup(server.Close)

	websocketURL := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, response, err := websocket.DefaultDialer.Dial(websocketURL, nil)
	if response != nil {
		defer func() {
			_ = response.Body.Close()
		}()
	}
	if err != nil {
		t.Fatalf("dialing WebSocket: %v", err)
	}
	defer func() {
		_ = conn.Close()
	}()

	received := make(map[string]bool, messageCount)
	for i := 0; i < messageCount; i++ {
		var message Message
		if err := conn.ReadJSON(&message); err != nil {
			t.Fatalf("reading message %d: %v", i, err)
		}
		if message.Type != "stdout" {
			t.Fatalf("message type = %q, want stdout", message.Type)
		}
		received[message.Data] = true
	}
	if len(received) != messageCount {
		t.Fatalf("received %d unique messages, want %d", len(received), messageCount)
	}
	select {
	case err := <-serverErrors:
		t.Fatalf("server write error: %v", err)
	default:
	}
}

func TestSendErrorUsesErrorMessageType(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		Serve(w, r, func(session *Session) {
			session.SendErrorMessage("terminal unavailable")
		})
	}))
	t.Cleanup(server.Close)

	websocketURL := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, response, err := websocket.DefaultDialer.Dial(websocketURL, nil)
	if response != nil {
		defer func() {
			_ = response.Body.Close()
		}()
	}
	if err != nil {
		t.Fatalf("dialing WebSocket: %v", err)
	}
	defer func() {
		_ = conn.Close()
	}()

	var message Message
	if err := conn.ReadJSON(&message); err != nil {
		t.Fatalf("reading error message: %v", err)
	}
	if message.Type != "error" || message.Data != "terminal unavailable" {
		t.Fatalf("error message = %#v", message)
	}
}
