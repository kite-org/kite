package helm

import (
	"testing"
	"time"
)

func timePtr(t time.Time) *time.Time {
	return &t
}

// versionsOf extracts the ordered version strings for assertions.
func versionsOf(versions []helmChartVersion) []string {
	out := make([]string, len(versions))
	for i, v := range versions {
		out[i] = v.Version
	}
	return out
}

func TestSortHelmChartVersions(t *testing.T) {
	older := timePtr(time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC))
	newer := timePtr(time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC))

	cases := []struct {
		name  string
		input []helmChartVersion
		want  []string
	}{
		{
			// Regression: publish time disagrees with semver order. 1.0.0 was
			// published later than 2.0.0 (e.g. a backported patch), but the
			// dropdown must still surface 2.0.0 first by semantic version.
			name: "semver beats publish time",
			input: []helmChartVersion{
				{Version: "1.0.0", PublishedAt: newer},
				{Version: "2.0.0", PublishedAt: older},
			},
			want: []string{"2.0.0", "1.0.0"},
		},
		{
			// Lexical sort would order 1.10.0 before 1.9.0 (or vice-versa);
			// semantic sort must treat 10 > 9 numerically.
			name: "numeric not lexical",
			input: []helmChartVersion{
				{Version: "1.2.0"},
				{Version: "1.9.0"},
				{Version: "1.10.0"},
			},
			want: []string{"1.10.0", "1.9.0", "1.2.0"},
		},
		{
			// Pre-releases rank below their final release, ordered by identifier.
			name: "prerelease ordering",
			input: []helmChartVersion{
				{Version: "1.0.0-rc.1"},
				{Version: "1.0.0"},
				{Version: "1.0.0-alpha"},
			},
			want: []string{"1.0.0", "1.0.0-rc.1", "1.0.0-alpha"},
		},
		{
			// "v" prefix is tolerated by ParseTolerant and must not break order.
			name: "tolerant v-prefix",
			input: []helmChartVersion{
				{Version: "v1.0.0"},
				{Version: "v1.2.0"},
				{Version: "v1.0.1"},
			},
			want: []string{"v1.2.0", "v1.0.1", "v1.0.0"},
		},
		{
			// Valid semver always ranks ahead of unparseable tags like "latest".
			name: "invalid semver falls behind",
			input: []helmChartVersion{
				{Version: "latest"},
				{Version: "1.2.3"},
			},
			want: []string{"1.2.3", "latest"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sortHelmChartVersions(tc.input)
			got := versionsOf(tc.input)
			if len(got) != len(tc.want) {
				t.Fatalf("length mismatch: got %v, want %v", got, tc.want)
			}
			for i := range tc.want {
				if got[i] != tc.want[i] {
					t.Fatalf("order mismatch: got %v, want %v", got, tc.want)
				}
			}
		})
	}
}

// TestSortHelmChartVersionsTimeTieBreak covers the fallback path: when two
// entries carry the same semantic version, the newer publish time wins.
func TestSortHelmChartVersionsTimeTieBreak(t *testing.T) {
	older := timePtr(time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC))
	newer := timePtr(time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC))

	versions := []helmChartVersion{
		{Version: "1.0.0", AppVersion: "old", PublishedAt: older},
		{Version: "1.0.0", AppVersion: "new", PublishedAt: newer},
	}
	sortHelmChartVersions(versions)

	if versions[0].AppVersion != "new" {
		t.Fatalf("expected newer publish time first for equal versions, got %q", versions[0].AppVersion)
	}
}

func TestCompareChartVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int // sign of the expected result
	}{
		{"2.0.0", "1.0.0", 1},
		{"1.10.0", "1.9.0", 1},
		{"1.0.0", "1.0.0", 0},
		{"1.0.0", "1.0.0-rc.1", 1}, // release > prerelease
		{"1.2.3", "latest", 1},     // valid semver > unparseable
		{"latest", "1.2.3", -1},
	}
	for _, tc := range cases {
		got := compareChartVersions(tc.a, tc.b)
		if sign(got) != tc.want {
			t.Fatalf("compareChartVersions(%q, %q) = %d, want sign %d", tc.a, tc.b, got, tc.want)
		}
	}
}

func sign(n int) int {
	switch {
	case n > 0:
		return 1
	case n < 0:
		return -1
	default:
		return 0
	}
}
