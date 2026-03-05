package ai

import (
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestResolveStaticResourceInfoCRD(t *testing.T) {
	info := resolveStaticResourceInfo("crds")
	if info.Kind != "CustomResourceDefinition" {
		t.Fatalf("unexpected kind: %s", info.Kind)
	}
	if info.Resource != "customresourcedefinitions" {
		t.Fatalf("unexpected resource: %s", info.Resource)
	}
	if info.Group != "apiextensions.k8s.io" {
		t.Fatalf("unexpected group: %s", info.Group)
	}
	if info.Version != "v1" {
		t.Fatalf("unexpected version: %s", info.Version)
	}
	if !info.ClusterScoped {
		t.Fatalf("expected cluster scoped")
	}
}

func TestResourceMatchesInputCRDVariants(t *testing.T) {
	resource := metav1.APIResource{
		Name:         "customresourcedefinitions",
		SingularName: "customresourcedefinition",
		Namespaced:   false,
		Kind:         "CustomResourceDefinition",
		ShortNames:   []string{"crd"},
	}

	cases := []string{
		"crd",
		"crds",
		"customresourcedefinition",
		"customresourcedefinitions",
		"customresourcedefinition.apiextensions.k8s.io",
		"customresourcedefinitions.apiextensions.k8s.io",
		"crd.apiextensions.k8s.io",
		"crds.apiextensions.k8s.io",
	}

	for _, input := range cases {
		if !resourceMatchesInput(input, "apiextensions.k8s.io", resource) {
			t.Fatalf("expected match for input %s", input)
		}
	}

	if resourceMatchesInput("crd.apps", "apiextensions.k8s.io", resource) {
		t.Fatalf("expected no match for crd.apps")
	}
}
