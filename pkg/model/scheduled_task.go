package model

import "time"

const (
	ScheduledTaskScheduleTypeInterval = "interval"
	ScheduledTaskScheduleTypeDaily    = "daily"
)

type ScheduledTask struct {
	Model
	ClusterName     string     `json:"clusterName" gorm:"type:varchar(100);not null;uniqueIndex:idx_scheduled_tasks_cluster_type_key;index"`
	Type            string     `json:"type" gorm:"type:varchar(100);not null;uniqueIndex:idx_scheduled_tasks_cluster_type_key;index"`
	Key             string     `json:"key" gorm:"type:varchar(255);not null;uniqueIndex:idx_scheduled_tasks_cluster_type_key"`
	Name            string     `json:"name" gorm:"type:varchar(255)"`
	Enabled         bool       `json:"enabled" gorm:"type:boolean;not null;default:false;index"`
	ScheduleType    string     `json:"scheduleType" gorm:"type:varchar(20);not null;default:interval;index"`
	IntervalMinutes int        `json:"intervalMinutes" gorm:"not null;default:60"`
	ScheduleTime    string     `json:"scheduleTime" gorm:"type:varchar(5);not null;default:03:00"`
	Payload         string     `json:"payload" gorm:"type:text"`
	LastRunAt       *time.Time `json:"lastRunAt,omitempty" gorm:"index"`
	NextRunAt       *time.Time `json:"nextRunAt,omitempty" gorm:"index"`
	LastSuccessAt   *time.Time `json:"lastSuccessAt,omitempty"`
	LastError       string     `json:"lastError,omitempty" gorm:"type:text"`
	LockedAt        *time.Time `json:"lockedAt,omitempty"`
	LockedBy        string     `json:"lockedBy,omitempty" gorm:"type:varchar(255)"`
	LockUntil       *time.Time `json:"lockUntil,omitempty" gorm:"index"`
}

func (ScheduledTask) TableName() string {
	return "scheduled_tasks"
}
