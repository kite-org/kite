package utils

import "testing"

func TestGuessSearchResources(t *testing.T) {
	testCases := []struct {
		name             string
		query            string
		wantResourceType string
		wantKeyword      string
	}{
		{
			name:             "empty query",
			query:            "   ",
			wantResourceType: "all",
			wantKeyword:      "",
		},
		{
			name:             "single token query",
			query:            "nginx",
			wantResourceType: "all",
			wantKeyword:      "nginx",
		},
		{
			name:             "known resource alias with keyword",
			query:            "po nginx",
			wantResourceType: "pods",
			wantKeyword:      "nginx",
		},
		{
			name:             "known resource with mixed case and extra spaces",
			query:            "  SVC    kube-dns   ",
			wantResourceType: "services",
			wantKeyword:      "kube-dns",
		},
		{
			name:             "unknown resource prefix",
			query:            "xyz kube-system",
			wantResourceType: "all",
			wantKeyword:      "xyz kube-system",
		},
		{
			name:             "multi-word keyword",
			query:            "deploy api server",
			wantResourceType: "deployments",
			wantKeyword:      "api server",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			gotResourceType, gotKeyword := GuessSearchResources(tc.query)
			if gotResourceType != tc.wantResourceType || gotKeyword != tc.wantKeyword {
				t.Fatalf(
					"GuessSearchResources(%q) = (%q, %q), want (%q, %q)",
					tc.query, gotResourceType, gotKeyword, tc.wantResourceType, tc.wantKeyword,
				)
			}
		})
	}
}
