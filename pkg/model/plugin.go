package model

import "time"

type Plugin struct {
	ID          string `gorm:"type:varchar(64);primaryKey"`
	Enabled     bool
	Version     string `gorm:"type:varchar(128);not null"`
	Digest      string `gorm:"type:varchar(64);not null"`
	DownloadURL string `gorm:"type:text"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
}
