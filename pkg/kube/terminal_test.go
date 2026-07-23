package kube

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/zxh326/kite/pkg/wsutil"
)

func TestTerminalSessionTransportsInputOutputAndResize(t *testing.T) {
	serverResults := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wsutil.Serve(w, r, func(ws *wsutil.Session) {
			session := NewTerminalSession(nil, ws.Conn, "default", "web", "app")
			defer session.Close()

			buffer := make([]byte, 64)
			n, err := session.Read(buffer)
			if err != nil {
				serverResults <- fmt.Errorf("stdin read: %w", err)
				return
			}
			if string(buffer[:n]) != "echo hello\n" {
				serverResults <- fmt.Errorf("stdin read = %q", buffer[:n])
				return
			}
			if _, err := session.Write([]byte("hello\n")); err != nil {
				serverResults <- fmt.Errorf("stdout write: %w", err)
				return
			}
			n, err = session.Read(buffer)
			if err != nil {
				serverResults <- fmt.Errorf("resize read: %w", err)
				return
			}
			if n != 0 {
				serverResults <- fmt.Errorf("resize read = %d", n)
				return
			}
			size := session.Next()
			if size == nil || size.Width != 120 || size.Height != 40 {
				serverResults <- fmt.Errorf("terminal size = %#v", size)
				return
			}
			serverResults <- nil
		})
	}))
	t.Cleanup(server.Close)

	url := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, response, err := websocket.DefaultDialer.Dial(url, nil)
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
	if err := conn.WriteJSON(TerminalMessage{Type: "stdin", Data: "echo hello\n"}); err != nil {
		t.Fatalf("writing stdin: %v", err)
	}
	var output wsutil.Message
	if err := conn.ReadJSON(&output); err != nil {
		t.Fatalf("reading stdout: %v", err)
	}
	if output.Type != "stdout" || output.Data != "hello\n" {
		t.Fatalf("stdout = %#v", output)
	}
	if err := conn.WriteJSON(TerminalMessage{Type: "resize", Rows: 40, Cols: 120}); err != nil {
		t.Fatalf("writing resize: %v", err)
	}
	if err := <-serverResults; err != nil {
		t.Fatal(err)
	}
}

func TestTerminalSessionRejectsUnknownMessageType(t *testing.T) {
	serverResults := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wsutil.Serve(w, r, func(ws *wsutil.Session) {
			session := NewTerminalSession(nil, ws.Conn, "default", "web", "app")
			defer session.Close()
			buffer := make([]byte, 8)
			n, err := session.Read(buffer)
			if err == nil {
				serverResults <- fmt.Errorf("unknown message read = %q, want error", buffer[:n])
				return
			}
			if string(buffer[:n]) != EndOfTransmission {
				serverResults <- fmt.Errorf("unknown message read = %q: %w", buffer[:n], err)
				return
			}
			serverResults <- nil
		})
	}))
	t.Cleanup(server.Close)

	url := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, response, err := websocket.DefaultDialer.Dial(url, nil)
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
	if err := conn.WriteJSON(TerminalMessage{Type: "unsupported"}); err != nil {
		t.Fatalf("writing unsupported message: %v", err)
	}
	if err := <-serverResults; err != nil {
		t.Fatal(err)
	}
}
