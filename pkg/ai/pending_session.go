package ai

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/zxh326/kite/pkg/model"
	"k8s.io/klog/v2"
)

const pendingSessionTTL = 15 * time.Minute

type pendingSession struct {
	Provider      string
	Model         string
	SystemPrompt  string
	Messages      []AgentMessage
	ToolCalls     []ToolCall
	ToolResults   []ContentBlock
	NextToolIndex int
	Iteration     int
	UserID        uint
	ClusterName   string
	ExpiresAt     time.Time
}

type pendingSessionStore struct{}

var agentPendingSessions = &pendingSessionStore{}

func (s *pendingSessionStore) save(session pendingSession) (string, error) {
	sessionID := newPendingSessionID()
	session.ExpiresAt = time.Now().Add(pendingSessionTTL)
	dbSession := &model.PendingSession{
		SessionID:     sessionID,
		Provider:      session.Provider,
		AIModel:       session.Model,
		SystemPrompt:  session.SystemPrompt,
		NextToolIndex: session.NextToolIndex,
		Iteration:     session.Iteration,
		UserID:        session.UserID,
		ClusterName:   session.ClusterName,
		ExpiresAt:     session.ExpiresAt,
	}
	if err := dbSession.Messages.Marshal(session.Messages); err != nil {
		return "", fmt.Errorf("failed to marshal pending messages: %w", err)
	}
	if err := dbSession.ToolCalls.Marshal(session.ToolCalls); err != nil {
		return "", fmt.Errorf("failed to marshal pending tool calls: %w", err)
	}
	if err := dbSession.ToolResults.Marshal(session.ToolResults); err != nil {
		return "", fmt.Errorf("failed to marshal pending tool results: %w", err)
	}
	if err := model.SavePendingSession(dbSession); err != nil {
		return "", err
	}

	go func() {
		if err := model.CleanupExpiredPendingSessions(); err != nil {
			klog.V(4).Infof("Failed to cleanup expired pending sessions: %v", err)
		}
	}()
	return sessionID, nil
}

func (s *pendingSessionStore) load(sessionID string) (pendingSession, error) {
	dbSession, err := model.GetPendingSession(sessionID)
	if err != nil {
		return pendingSession{}, fmt.Errorf("pending action not found or expired")
	}

	session := pendingSession{
		Provider:      dbSession.Provider,
		Model:         dbSession.AIModel,
		SystemPrompt:  dbSession.SystemPrompt,
		NextToolIndex: dbSession.NextToolIndex,
		Iteration:     dbSession.Iteration,
		UserID:        dbSession.UserID,
		ClusterName:   dbSession.ClusterName,
		ExpiresAt:     dbSession.ExpiresAt,
	}
	if err := dbSession.Messages.Unmarshal(&session.Messages); err != nil {
		return pendingSession{}, fmt.Errorf("failed to unmarshal pending messages: %w", err)
	}
	if err := dbSession.ToolCalls.Unmarshal(&session.ToolCalls); err != nil {
		return pendingSession{}, fmt.Errorf("failed to unmarshal pending tool calls: %w", err)
	}
	if err := dbSession.ToolResults.Unmarshal(&session.ToolResults); err != nil {
		return pendingSession{}, fmt.Errorf("failed to unmarshal pending tool results: %w", err)
	}
	return session, nil
}

func (s *pendingSessionStore) claim(sessionID string) error {
	deleted, err := model.DeletePendingSession(sessionID)
	if err != nil {
		return err
	}
	if !deleted {
		return fmt.Errorf("pending action not found or expired")
	}
	return nil
}

func newPendingSessionID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err == nil {
		return hex.EncodeToString(buf)
	}
	return fmt.Sprintf("pending-%d", time.Now().UnixNano())
}
