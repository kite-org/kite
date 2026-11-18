package helmutil

import (
	"testing"

	chart "helm.sh/helm/v4/pkg/chart/v2"
	releasecommon "helm.sh/helm/v4/pkg/release/common"
	release "helm.sh/helm/v4/pkg/release/v1"
)

func TestToHelmRelease_DetailsToggle(t *testing.T) {
	rel := &release.Release{
		Name:      "demo",
		Namespace: "default",
		Version:   3,
		Config:    map[string]interface{}{"secretKey": "super-secret"},
		Manifest:  "apiVersion: v1\nkind: Secret\nmetadata:\n  name: app-secret\n",
		Hooks: []*release.Hook{
			{Name: "pre-install"},
		},
		Chart: &chart.Chart{
			Metadata: &chart.Metadata{
				Name:       "demo-chart",
				Version:    "1.2.3",
				AppVersion: "v1.2.3",
			},
			Values: map[string]interface{}{"defaultKey": "default-val"},
		},
		Info: &release.Info{
			Status:      releasecommon.StatusDeployed,
			Description: "Install complete",
			Notes:       "internal notes",
		},
	}

	summary := ToHelmRelease(rel, false)
	if summary.Spec.Values != nil {
		t.Fatalf("summary Spec.Values = %#v, want nil", summary.Spec.Values)
	}
	if summary.Spec.DefaultValues != nil {
		t.Fatalf("summary Spec.DefaultValues = %#v, want nil", summary.Spec.DefaultValues)
	}
	if summary.Spec.Manifest != "" {
		t.Fatalf("summary Spec.Manifest = %q, want empty", summary.Spec.Manifest)
	}
	if len(summary.Spec.Hooks) != 0 {
		t.Fatalf("summary Spec.Hooks = %#v, want empty", summary.Spec.Hooks)
	}
	if summary.Spec.Notes != "" {
		t.Fatalf("summary Spec.Notes = %q, want empty", summary.Spec.Notes)
	}
	if summary.Spec.ChartName != "demo-chart" || summary.Spec.ChartVersion != "1.2.3" || summary.Status.Status != "deployed" {
		t.Fatalf("summary metadata unexpectedly stripped: %#v", summary)
	}

	detail := ToHelmRelease(rel, true)
	if detail.Spec.Values["secretKey"] != "super-secret" {
		t.Fatalf("detail Spec.Values = %#v, want secretKey", detail.Spec.Values)
	}
	if detail.Spec.DefaultValues["defaultKey"] != "default-val" {
		t.Fatalf("detail Spec.DefaultValues = %#v, want defaultKey", detail.Spec.DefaultValues)
	}
	if detail.Spec.Manifest == "" || len(detail.Spec.Hooks) != 1 || detail.Spec.Notes != "internal notes" {
		t.Fatalf("detail fields missing: %#v", detail.Spec)
	}
}
