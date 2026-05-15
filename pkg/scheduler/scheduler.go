package scheduler

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/zxh326/kite/pkg/model"
	"k8s.io/klog/v2"
)

const (
	defaultScanInterval = time.Minute
	defaultLockDuration = 10 * time.Minute
)

type Executor interface {
	Run(context.Context, model.ScheduledTask) error
}

type Manager struct {
	executors    map[string]Executor
	instanceID   string
	scanInterval time.Duration
	lockDuration time.Duration
}

func NewManager() *Manager {
	hostname, _ := os.Hostname()
	return &Manager{
		executors:    map[string]Executor{},
		instanceID:   fmt.Sprintf("%s-%d", hostname, os.Getpid()),
		scanInterval: defaultScanInterval,
		lockDuration: defaultLockDuration,
	}
}

func (m *Manager) Register(taskType string, executor Executor) {
	m.executors[taskType] = executor
}

func (m *Manager) Start(ctx context.Context) {
	go m.run(ctx)
}

func (m *Manager) run(ctx context.Context) {
	ticker := time.NewTicker(m.scanInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.runDue(ctx)
		}
	}
}

func (m *Manager) runDue(ctx context.Context) {
	now := time.Now()
	var tasks []model.ScheduledTask
	if err := model.DB.
		Where("enabled = ?", true).
		Where("next_run_at IS NULL OR next_run_at <= ?", now).
		Where("lock_until IS NULL OR lock_until < ?", now).
		Find(&tasks).Error; err != nil {
		klog.Errorf("Failed to list scheduled tasks: %v", err)
		return
	}
	for i := range tasks {
		if ctx.Err() != nil {
			return
		}
		task := tasks[i]
		if !m.acquire(task, now) {
			continue
		}
		m.runTask(ctx, task)
	}
}

func (m *Manager) acquire(task model.ScheduledTask, now time.Time) bool {
	lockUntil := now.Add(m.lockDuration)
	result := model.DB.Model(&model.ScheduledTask{}).
		Where("id = ? AND (lock_until IS NULL OR lock_until < ?)", task.ID, now).
		Updates(map[string]interface{}{
			"locked_at":  now,
			"locked_by":  m.instanceID,
			"lock_until": lockUntil,
		})
	if result.Error != nil {
		klog.Errorf("Failed to lock scheduled task %s/%s/%s: %v", task.ClusterName, task.Type, task.Key, result.Error)
		return false
	}
	return result.RowsAffected == 1
}

func (m *Manager) runTask(ctx context.Context, task model.ScheduledTask) {
	runAt := time.Now()
	klog.Infof("Scheduled task started: cluster=%s type=%s key=%s id=%d", task.ClusterName, task.Type, task.Key, task.ID)
	executor := m.executors[task.Type]
	var err error
	if executor == nil {
		err = fmt.Errorf("scheduled task executor not found: %s", task.Type)
	} else {
		err = executor.Run(ctx, task)
	}
	m.finish(task, runAt, err)
	if err != nil {
		klog.Errorf("Scheduled task finished with error: cluster=%s type=%s key=%s id=%d duration=%s error=%v", task.ClusterName, task.Type, task.Key, task.ID, time.Since(runAt), err)
		return
	}
	klog.Infof("Scheduled task finished: cluster=%s type=%s key=%s id=%d duration=%s", task.ClusterName, task.Type, task.Key, task.ID, time.Since(runAt))
}

func (m *Manager) finish(task model.ScheduledTask, runAt time.Time, err error) {
	nextRunAt, scheduleErr := NextRunAt(runAt, task.ScheduleType, task.IntervalMinutes, task.ScheduleTime)
	updates := map[string]interface{}{
		"last_run_at": runAt,
		"last_error":  "",
		"locked_at":   nil,
		"locked_by":   "",
		"lock_until":  nil,
	}
	if scheduleErr == nil {
		updates["next_run_at"] = nextRunAt
	}
	switch {
	case err != nil:
		updates["last_error"] = err.Error()
	case scheduleErr != nil:
		updates["last_error"] = scheduleErr.Error()
	default:
		updates["last_success_at"] = runAt
	}
	if dbErr := model.DB.Model(&model.ScheduledTask{}).Where("id = ?", task.ID).Updates(updates).Error; dbErr != nil {
		klog.Errorf("Failed to update scheduled task %s/%s/%s: %v", task.ClusterName, task.Type, task.Key, dbErr)
	}
}

func NextRunAt(from time.Time, scheduleType string, intervalMinutes int, scheduleTime string) (time.Time, error) {
	switch scheduleType {
	case model.ScheduledTaskScheduleTypeInterval:
		if intervalMinutes < 1 {
			return time.Time{}, fmt.Errorf("intervalMinutes must be at least 1")
		}
		return from.Add(time.Duration(intervalMinutes) * time.Minute), nil
	case model.ScheduledTaskScheduleTypeDaily:
		hour, minute, err := parseScheduleTime(scheduleTime)
		if err != nil {
			return time.Time{}, err
		}
		next := time.Date(from.Year(), from.Month(), from.Day(), hour, minute, 0, 0, from.Location())
		if !next.After(from) {
			next = next.AddDate(0, 0, 1)
		}
		return next, nil
	default:
		return time.Time{}, fmt.Errorf("unsupported scheduleType: %s", scheduleType)
	}
}

func parseScheduleTime(value string) (int, int, error) {
	parsed, err := time.Parse("15:04", value)
	if err != nil {
		return 0, 0, fmt.Errorf("scheduleTime must use HH:MM")
	}
	return parsed.Hour(), parsed.Minute(), nil
}
