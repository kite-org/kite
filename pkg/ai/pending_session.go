package ai

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/openai/openai-go"
)

const pendingSessionTTL = 15 * time.Minute

type pendingToolCall struct {
	ID   string
	Name string
	Args map[string]interface{}
}

type pendingSession struct {
	Provider          string
	SystemPrompt      string
	OpenAIMessages    []openai.ChatCompletionMessageParamUnion
	AnthropicMessages []anthropic.MessageParam
	ToolCall          pendingToolCall
	ExpiresAt         time.Time
}

type pendingSessionStore struct {
	mu       sync.Mutex
	sessions map[string]pendingSession
}

var agentPendingSessions = &pendingSessionStore{
	sessions: make(map[string]pendingSession),
}

func (s *pendingSessionStore) save(session pendingSession) string {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	s.cleanupExpiredLocked(now)
	sessionID := newPendingSessionID()
	session.ExpiresAt = now.Add(pendingSessionTTL)
	s.sessions[sessionID] = session
	return sessionID
}

func (s *pendingSessionStore) take(sessionID string) (pendingSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.cleanupExpiredLocked(time.Now())
	session, ok := s.sessions[sessionID]
	if !ok {
		return pendingSession{}, fmt.Errorf("pending action not found or expired")
	}
	delete(s.sessions, sessionID)
	return session, nil
}

func (s *pendingSessionStore) cleanupExpiredLocked(now time.Time) {
	for id, session := range s.sessions {
		if now.After(session.ExpiresAt) {
			delete(s.sessions, id)
		}
	}
}

func newPendingSessionID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err == nil {
		return hex.EncodeToString(buf)
	}
	return fmt.Sprintf("pending-%d", time.Now().UnixNano())
}
