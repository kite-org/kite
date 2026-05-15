package helmutil

import (
	"fmt"
	"strings"

	release "helm.sh/helm/v4/pkg/release/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/yaml"
)

var manifestClusterScopedKinds = map[string]struct{}{
	"apiservice":                       {},
	"certificatesigningrequest":        {},
	"clusterrole":                      {},
	"clusterrolebinding":               {},
	"customresourcedefinition":         {},
	"gatewayclass":                     {},
	"mutatingwebhookconfiguration":     {},
	"namespace":                        {},
	"node":                             {},
	"persistentvolume":                 {},
	"podsecuritypolicy":                {},
	"priorityclass":                    {},
	"storageclass":                     {},
	"validatingadmissionpolicy":        {},
	"validatingadmissionpolicybinding": {},
	"validatingwebhookconfiguration":   {},
	"volumesnapshotclass":              {},
	"volumesnapshotcontent":            {},
}

func ToHelmReleaseDryRunResponse(rel *release.Release) HelmReleaseDryRunResponse {
	return HelmReleaseDryRunResponse{
		Resources: resolveManifestPreviewResources(rel.Manifest, rel.Namespace),
	}
}

func ToHelmReleaseDryRunDiffResponse(current, next *release.Release) HelmReleaseDryRunResponse {
	return HelmReleaseDryRunResponse{
		Resources: diffManifestPreviewResources(
			current.Manifest,
			current.Namespace,
			next.Manifest,
			next.Namespace,
		),
	}
}

func resolveManifestResources(manifest, defaultNamespace string) []HelmReleaseResource {
	out := []HelmReleaseResource{}
	for _, doc := range splitManifestDocuments(manifest) {
		if isCommentOnlyManifestDocument(doc) {
			continue
		}
		var u unstructured.Unstructured
		if err := yaml.Unmarshal([]byte(doc), &u.Object); err != nil || u.GetKind() == "" || u.GetName() == "" {
			continue
		}
		ns := u.GetNamespace()
		_, clusterScoped := manifestClusterScopedKinds[strings.ToLower(u.GetKind())]
		if ns == "" && !clusterScoped {
			ns = defaultNamespace
		}
		out = append(out, HelmReleaseResource{
			APIVersion: u.GetAPIVersion(),
			Kind:       u.GetKind(),
			Name:       u.GetName(),
			Namespace:  ns,
		})
	}
	return out
}

func resolveManifestPreviewResources(manifest, defaultNamespace string) []HelmReleaseDryRunResource {
	out := []HelmReleaseDryRunResource{}
	for i, doc := range splitManifestDocuments(manifest) {
		if isCommentOnlyManifestDocument(doc) {
			continue
		}
		content := trimHelmSourceComment(doc)
		var u unstructured.Unstructured
		if err := yaml.Unmarshal([]byte(doc), &u.Object); err != nil || u.GetKind() == "" || u.GetName() == "" {
			out = append(out, HelmReleaseDryRunResource{
				Path:    fmt.Sprintf("manifest-%d.yaml", i+1),
				Content: content,
			})
			continue
		}
		ns := u.GetNamespace()
		_, clusterScoped := manifestClusterScopedKinds[strings.ToLower(u.GetKind())]
		if ns == "" && !clusterScoped {
			ns = defaultNamespace
		}
		resource := HelmReleaseResource{
			APIVersion: u.GetAPIVersion(),
			Kind:       u.GetKind(),
			Name:       u.GetName(),
			Namespace:  ns,
		}
		out = append(out, HelmReleaseDryRunResource{
			HelmReleaseResource: resource,
			Path:                manifestPreviewPath(resource, i),
			Content:             content,
		})
	}
	return out
}

func diffManifestPreviewResources(currentManifest, currentNamespace, nextManifest, nextNamespace string) []HelmReleaseDryRunResource {
	currentResources := resolveManifestPreviewResources(currentManifest, currentNamespace)
	nextResources := resolveManifestPreviewResources(nextManifest, nextNamespace)
	currentByPath := make(map[string]HelmReleaseDryRunResource, len(currentResources))
	nextByPath := make(map[string]HelmReleaseDryRunResource, len(nextResources))
	for _, resource := range currentResources {
		currentByPath[resource.Path] = resource
	}
	for _, resource := range nextResources {
		nextByPath[resource.Path] = resource
	}

	out := make([]HelmReleaseDryRunResource, 0, len(currentResources)+len(nextResources))
	seen := make(map[string]struct{}, len(currentResources)+len(nextResources))
	for _, resource := range nextResources {
		if _, ok := seen[resource.Path]; ok {
			continue
		}
		seen[resource.Path] = struct{}{}
		nextResource := nextByPath[resource.Path]
		currentResource, exists := currentByPath[resource.Path]
		nextResource.OriginalContent = currentResource.Content
		nextResource.ModifiedContent = nextResource.Content
		switch {
		case !exists:
			nextResource.Status = "added"
		case currentResource.Content == nextResource.Content:
			nextResource.Status = "unchanged"
		default:
			nextResource.Status = "changed"
		}
		out = append(out, nextResource)
	}

	for _, resource := range currentResources {
		if _, ok := seen[resource.Path]; ok {
			continue
		}
		if _, exists := nextByPath[resource.Path]; exists {
			continue
		}
		resource.OriginalContent = resource.Content
		resource.ModifiedContent = ""
		resource.Status = "deleted"
		out = append(out, resource)
	}
	return out
}

func splitManifestDocuments(manifest string) []string {
	docs := []string{}
	lines := []string{}
	for _, line := range strings.Split(manifest, "\n") {
		marker := strings.TrimRight(line, " \t\r")
		if marker == "---" || strings.HasPrefix(marker, "--- #") {
			doc := strings.TrimSpace(strings.Join(lines, "\n"))
			if doc != "" {
				docs = append(docs, doc)
			}
			lines = lines[:0]
			continue
		}
		lines = append(lines, line)
	}

	doc := strings.TrimSpace(strings.Join(lines, "\n"))
	if doc != "" {
		docs = append(docs, doc)
	}
	return docs
}

func isCommentOnlyManifestDocument(content string) bool {
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "#") {
			return false
		}
	}
	return true
}

func trimHelmSourceComment(content string) string {
	lines := strings.Split(content, "\n")
	if len(lines) == 0 || !strings.HasPrefix(strings.TrimSpace(lines[0]), "# Source:") {
		return content
	}
	return strings.TrimSpace(strings.Join(lines[1:], "\n"))
}

func manifestPreviewPath(resource HelmReleaseResource, index int) string {
	scope := resource.Namespace
	if scope == "" {
		scope = "cluster"
	}
	kind := resource.Kind
	if kind == "" {
		kind = "Resource"
	}
	name := resource.Name
	if name == "" {
		name = fmt.Sprintf("manifest-%d", index+1)
	}
	return scope + "/" + kind + "/" + name + ".yaml"
}
