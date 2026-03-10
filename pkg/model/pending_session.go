package model

import (
	"time"
)

type PendingSession struct {
	Model
	SessionID         string    `json:"session_id" gorm:"type:varchar(64);uniqueIndex;not null"`
	Provider          string    `json:"provider" gorm:"type:varchar(32);not null"`
	SystemPrompt      string    `json:"system_prompt" gorm:"type:text"`
	OpenAIMessages    JSONField `json:"openai_messages" gorm:"type:text"`
	AnthropicMessages JSONField `json:"anthropic_messages" gorm:"type:text"`
	ToolCallID        string    `json:"tool_call_id" gorm:"type:varchar(255)"`
	ToolCallName      string    `json:"tool_call_name" gorm:"type:varchar(255)"`
	ToolCallArgs      JSONField `json:"tool_call_args" gorm:"type:text"`
	ExpiresAt         time.Time `json:"expires_at" gorm:"index;not null"`
}

func SavePendingSession(session *PendingSession) error {
	return DB.Create(session).Error
}

func GetPendingSession(sessionID string) (*PendingSession, error) {
	var session PendingSession
	if err := DB.Where("session_id = ? AND expires_at > ?", sessionID, time.Now()).First(&session).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

func DeletePendingSession(sessionID string) error {
	return DB.Where("session_id = ?", sessionID).Delete(&PendingSession{}).Error
}

func CleanupExpiredPendingSessions() error {
	return DB.Where("expires_at <= ?", time.Now()).Delete(&PendingSession{}).Error
}
