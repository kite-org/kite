package utils

import (
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/util/validation"
)

func TestInjectKiteBase(t *testing.T) {
	html := `<html><head><link rel="modulepreload" href="__KITE_BASE__/assets/index.js"><script type="module" src="__KITE_BASE__/assets/main.js"></script></head></html>`

	t.Run("subpath", func(t *testing.T) {
		got := InjectKiteBase(html, "/kite")

		if strings.Contains(got, "__KITE_BASE__") {
			t.Fatalf("placeholder should be replaced: %s", got)
		}
		if strings.Contains(got, "<base ") {
			t.Fatalf("base tag should not be injected anymore: %s", got)
		}
		if !strings.Contains(got, `href="/kite/assets/index.js"`) {
			t.Fatalf("expected asset href to include subpath: %s", got)
		}
		if !strings.Contains(got, `src="/kite/assets/main.js"`) {
			t.Fatalf("expected asset src to include subpath: %s", got)
		}
		if !strings.Contains(got, `<script>window.__dynamic_base__="/kite";</script>`) {
			t.Fatalf("expected runtime base script: %s", got)
		}
	})

	t.Run("root", func(t *testing.T) {
		got := InjectKiteBase(html, "")

		if !strings.Contains(got, `href="/assets/index.js"`) {
			t.Fatalf("expected root asset href: %s", got)
		}
		if !strings.Contains(got, `src="/assets/main.js"`) {
			t.Fatalf("expected root asset src: %s", got)
		}
		if !strings.Contains(got, `<script>window.__dynamic_base__="";</script>`) {
			t.Fatalf("expected empty runtime base script: %s", got)
		}
	})

	t.Run("escapes html attribute injection", func(t *testing.T) {
		got := InjectKiteBase(html, `/ki"te`)

		if strings.Contains(got, `href="/ki"te/assets/index.js"`) {
			t.Fatalf("expected asset href to be escaped: %s", got)
		}
		if !strings.Contains(got, `href="/ki&#34;te/assets/index.js"`) {
			t.Fatalf("expected escaped quote in asset href: %s", got)
		}
		if !strings.Contains(got, `<script>window.__dynamic_base__="/ki\"te";</script>`) {
			t.Fatalf("expected runtime base script to remain safely quoted: %s", got)
		}
	})
}

func TestGetImageRegistryAndRepo(t *testing.T) {
	testcase := []struct {
		image    string
		registry string
		repo     string
	}{
		{"nginx", "", "library/nginx"},
		{"nginx:latest", "", "library/nginx"},
		{"zzde/kite:latest", "", "zzde/kite"},
		{"docker.io/library/nginx", "docker.io", "library/nginx"},
		{"docker.io/library/nginx:latest", "docker.io", "library/nginx"},
		{"gcr.io/my-project/my-image", "gcr.io", "my-project/my-image"},
		{"gcr.io/my-project/my-image:tag", "gcr.io", "my-project/my-image"},
		{"quay.io/my-org/my-repo", "quay.io", "my-org/my-repo"},
		{"quay.io/my-org/my-repo:tag", "quay.io", "my-org/my-repo"},
		{"registry.example.com/my-repo/test", "registry.example.com", "my-repo/test"},
	}
	for _, tc := range testcase {
		registry, repo := GetImageRegistryAndRepo(tc.image)
		if registry != tc.registry || repo != tc.repo {
			t.Errorf("GetImageRegistryAndRepo(%q) = (%q, %q), want (%q, %q)", tc.image, registry, repo, tc.registry, tc.repo)
		}
	}
}

func TestGenerateNodeAgentName(t *testing.T) {
	testcase := []struct {
		nodeName string
	}{
		{"node1"},
		{"shortname"},
		{"a-very-long-node-name-that-exceeds-the-maximum-length-allowed-for-kubernetes-names"},
		{"node-with-63-characters-abcdefghijklmnopqrstuvwxyz-123456789101"},
		{"ip-10-0-10-10.ch-west-2.compute.internal"},
		{"ip-10-0-10-10.ch-west-2.compute-internal"},
	}

	for _, tc := range testcase {
		podName := GenerateNodeAgentName(tc.nodeName)
		if errs := validation.IsDNS1123Subdomain(podName); len(errs) > 0 {
			t.Errorf("GenerateNodeAgentName(%q) = %q, invalid DNS subdomain: %v", tc.nodeName, podName, errs)
		}
	}
}
