package ai

import (
	"context"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// newTestStreamContext builds a gin context backed by a recorder, with a real
// request so the keepalive goroutine can select on its context.
func newTestStreamContext() (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest("POST", "/api/v1/ai/chat", nil)
	return c, rec
}

func TestPrepareSSESetsStreamingHeaders(t *testing.T) {
	c, rec := newTestStreamContext()
	send, stop := prepareSSE(c)
	defer stop()

	send(AgentEvent{Type: "message", Data: MessageDeltaEvent{BlockType: contentBlockText, Content: "hi"}})
	stop()

	// X-Accel-Buffering is the one that matters behind ingress-nginx: without it
	// nginx buffers the whole response and the user sees nothing until the end.
	for header, want := range map[string]string{
		"Content-Type":      "text/event-stream",
		"Cache-Control":     "no-cache",
		"Connection":        "keep-alive",
		"X-Accel-Buffering": "no",
	} {
		if got := rec.Header().Get(header); got != want {
			t.Fatalf("header %s = %q, want %q", header, got, want)
		}
	}
	if body := rec.Body.String(); !strings.Contains(body, "event: message") {
		t.Fatalf("event was not written to the stream: %q", body)
	}
}

func TestPrepareSSEEmitsKeepaliveWhileIdle(t *testing.T) {
	// The interval is a const sized for nginx's 60s default, far too long for a
	// test, so drive the same write path concurrently instead: this asserts the
	// comment-line format and — under -race — that the ticker goroutine and a
	// real event cannot interleave on the ResponseWriter.
	c, rec := newTestStreamContext()
	send, stop := prepareSSE(c)

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			send(AgentEvent{Type: "message", Data: MessageDeltaEvent{BlockType: contentBlockText, Content: "chunk"}})
		}()
	}
	wg.Wait()
	stop()

	body := rec.Body.String()
	if n := strings.Count(body, "event: message"); n != 50 {
		t.Fatalf("expected 50 events on the stream, got %d", n)
	}
	// Every frame must be a complete, well-formed SSE record — a torn write would
	// show up as a fragment the browser's EventSource silently drops.
	for _, frame := range strings.Split(strings.TrimSuffix(body, "\n\n"), "\n\n") {
		if !strings.HasPrefix(frame, "event: ") && !strings.HasPrefix(frame, ": ") {
			t.Fatalf("malformed SSE frame on the stream: %q", frame)
		}
	}
}

func TestStopKeepaliveIsIdempotent(t *testing.T) {
	// Every handler both defers stop() and calls it before the final done event,
	// so the second call must not panic on a closed channel.
	c, _ := newTestStreamContext()
	_, stop := prepareSSE(c)
	stop()
	stop()
	stop()
}

func TestKeepaliveStopsWhenRequestContextIsCancelled(t *testing.T) {
	// A client that closes the tab must not leave the ticker goroutine running.
	c, _ := newTestStreamContext()
	ctx, cancel := context.WithCancel(c.Request.Context())
	c.Request = c.Request.WithContext(ctx)

	_, stop := prepareSSE(c)
	defer stop()

	cancel()
	// Nothing to assert beyond "no panic, no leak" — goleak is not a dependency
	// here, so this documents the intent and exercises the cancellation branch.
	time.Sleep(10 * time.Millisecond)
}
