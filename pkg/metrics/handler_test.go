package metrics

import (
	"testing"
	"time"

	"github.com/zxh326/kite/pkg/prometheus"
)

func TestMergeUsageDataPointsSum(t *testing.T) {
	base := time.Date(2026, 3, 27, 10, 0, 0, 0, time.UTC)
	points := []prometheus.UsageDataPoint{
		{Timestamp: base.Add(200 * time.Millisecond), Value: 0.3},
		{Timestamp: base.Add(1 * time.Second), Value: 0.4},
		{Timestamp: base, Value: 0.2},
	}

	got := mergeUsageDataPointsSum(points)

	if len(got) != 2 {
		t.Fatalf("mergeUsageDataPointsSum() len = %d, want 2", len(got))
	}
	if got[0].Timestamp.Unix() != base.Unix() {
		t.Fatalf("first timestamp = %d, want %d", got[0].Timestamp.Unix(), base.Unix())
	}
	if got[0].Value != 0.5 {
		t.Fatalf("first value = %v, want 0.5", got[0].Value)
	}
	if got[1].Timestamp.Unix() != base.Add(1*time.Second).Unix() {
		t.Fatalf("second timestamp = %d, want %d", got[1].Timestamp.Unix(), base.Add(1*time.Second).Unix())
	}
	if got[1].Value != 0.4 {
		t.Fatalf("second value = %v, want 0.4", got[1].Value)
	}
}
