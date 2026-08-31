package model

import (
	"time"
)

type PendingSession struct {
	Model
	SessionID     string    `json:"session_id" gorm:"type:varchar(64);uniqueIndex;not null"`
	Provider      string    `json:"provider" gorm:"type:varchar(32);not null"`
	AIModel       string    `json:"ai_model" gorm:"type:varchar(255);not null;default:''"`
	SystemPrompt  string    `json:"system_prompt" gorm:"type:text"`
	Messages      JSONField `json:"messages" gorm:"type:text"`
	ToolCalls     JSONField `json:"tool_calls" gorm:"type:text"`
	ToolResults   JSONField `json:"tool_results" gorm:"type:text"`
	NextToolIndex int       `json:"next_tool_index" gorm:"not null;default:0"`
	Iteration     int       `json:"iteration" gorm:"not null;default:0"`
	UserID        uint      `json:"user_id" gorm:"index;not null;default:0"`
	ClusterName   string    `json:"cluster_name" gorm:"type:varchar(255);index;not null;default:''"`
	ExpiresAt     time.Time `json:"expires_at" gorm:"index;not null"`
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

func DeletePendingSession(sessionID string) (bool, error) {
	result := DB.Where("session_id = ?", sessionID).Delete(&PendingSession{})
	return result.RowsAffected == 1, result.Error
}

func CleanupExpiredPendingSessions() error {
	return DB.Where("expires_at <= ?", time.Now()).Delete(&PendingSession{}).Error
}
