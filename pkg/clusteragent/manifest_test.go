package clusteragent

import (
	"strings"
	"testing"
)

func TestGenerateManifest(t *testing.T) {
	manifest := GenerateManifest("https://kite.example.com", "my-token", "public-key", "ghcr.io/kite-org/kite:v1.0")

	checks := []string{
		"apiVersion: v1\nkind: Secret",
		"name: kite-cluster-agent-token",
		"namespace: kube-system",
		"token: \"my-token\"",
		"apiVersion: v1\nkind: ServiceAccount",
		"name: kite-cluster-agent",
		"apiVersion: rbac.authorization.k8s.io/v1\nkind: ClusterRoleBinding",
		"name: cluster-admin",
		"apiVersion: apps/v1\nkind: Deployment",
		`image: "ghcr.io/kite-org/kite:v1.0"`,
		"--server=$(KITE_SERVER)",
		"--token=$(CLUSTER_AGENT_TOKEN)",
		"value: \"https://kite.example.com\"",
	}
	for _, want := range checks {
		if !strings.Contains(manifest, want) {
			t.Errorf("manifest missing %q\n--- manifest ---\n%s", want, manifest)
		}
	}

	// Should contain exactly 4 documents separated by ---
	if strings.Count(manifest, "---") != 3 {
		t.Errorf("expected 3 document separators, got %d", strings.Count(manifest, "---"))
	}
}

func TestGenerateManifestWhitespaceTrimmed(t *testing.T) {
	manifest := GenerateManifest("  https://kite.example.com  ", "  tok  ", "  public-key  ", "  img:tag  ")
	if !strings.Contains(manifest, `"https://kite.example.com"`) {
		t.Errorf("serverURL not trimmed:\n%s", manifest)
	}
	if !strings.Contains(manifest, `"tok"`) {
		t.Errorf("token not trimmed:\n%s", manifest)
	}
	if !strings.Contains(manifest, `image: "img:tag"`) {
		t.Errorf("image not trimmed:\n%s", manifest)
	}
}

func TestGenerateManifestSpecialCharacters(t *testing.T) {
	// Token with special characters that would break YAML if not quoted.
	manifest := GenerateManifest("https://kite.example.com", "tok:en\"'", "public-key", "img")
	if !strings.Contains(manifest, `"tok:en\"'"`) {
		t.Errorf("special characters in token not properly escaped:\n%s", manifest)
	}
}
