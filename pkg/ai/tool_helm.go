package ai

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/helmutil"
	pkgmodel "github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"github.com/zxh326/kite/pkg/scheduler"
	"helm.sh/helm/v4/pkg/action"
	release "helm.sh/helm/v4/pkg/release/v1"
	"k8s.io/klog/v2"
	"sigs.k8s.io/yaml"
)

const (
	helmToolTimeout = 5 * time.Minute

	// maxListedHelmReleases bounds a single list_helm_releases result.
	maxListedHelmReleases = 100
	// maxHelmHistoryItems bounds a get_helm_release_history result; items are
	// newest-first, so the cap drops only the oldest revisions.
	maxHelmHistoryItems = 20
	// maxHelmManagedResources bounds the managed-resources section of a release
	// detail.
	maxHelmManagedResources = 50
	// maxHelmValuesChars bounds each values section of a release detail so one
	// large chart cannot consume the whole tool-result budget.
	maxHelmValuesChars = 10000
)

var (
	// sensitiveHelmValueKeyMarkers mirrors the Secret masking in
	// redactSensitiveResourceData: helm values routinely carry the credentials
	// that charts template into Secrets, and tool results are persisted into
	// the transcript sent to the AI provider.
	sensitiveHelmValueKeyMarkers = []string{
		"password", "passwd", "pwd", "secret", "token", "credential", "apikey", "accesskey", "privatekey",
	}
	// exemptHelmValueKeyMarkers are Secret *references* (names of Secret
	// objects, not their contents); masking them would hide non-confidential
	// data the model needs and break value round-trips.
	exemptHelmValueKeyMarkers = []string{
		"secretname", "existingsecret", "imagepullsecret", "secretref", "secretkeyref",
	}
	helmValueKeyNormalizer = strings.NewReplacer("-", "", "_", "", ".", "")
)

func helmActionConfig(cs *cluster.ClientSet, namespace string) (*action.Configuration, error) {
	return helmutil.NewActionConfig(cs.K8sClient.Configuration, helmutil.StorageNamespace(namespace))
}

func executeListHelmReleases(_ context.Context, cs *cluster.ClientSet, user pkgmodel.User, args map[string]interface{}) (string, bool) {
	namespace, _ := args["namespace"].(string)
	namespace = strings.TrimSpace(namespace)
	allNamespaces := namespace == "" || namespace == common.AllNamespaces

	cfg, err := helmActionConfig(cs, namespace)
	if err != nil {
		return fmt.Sprintf("Error building Helm client: %v", err), true
	}
	releases, err := helmutil.ListReleases(cfg, allNamespaces, "")
	if err != nil {
		return fmt.Sprintf("Error listing Helm releases: %v", err), true
	}
	if allNamespaces {
		visible := make([]*release.Release, 0, len(releases))
		for _, rel := range releases {
			if rbac.CanAccess(user, string(common.HelmReleases), string(common.VerbGet), cs.Name, rel.Namespace) {
				visible = append(visible, rel)
			}
		}
		releases = visible
	}
	if len(releases) == 0 {
		if allNamespaces {
			return "No Helm releases found in the cluster", false
		}
		return fmt.Sprintf("No Helm releases found in namespace %s", namespace), false
	}

	sort.Slice(releases, func(i, j int) bool {
		if releases[i].Namespace != releases[j].Namespace {
			return releases[i].Namespace < releases[j].Namespace
		}
		return releases[i].Name < releases[j].Name
	})

	var sb strings.Builder
	fmt.Fprintf(&sb, "Found %d Helm release(s):\n", len(releases))
	for i, rel := range releases {
		if i >= maxListedHelmReleases {
			fmt.Fprintf(&sb, "[... %d more releases omitted, narrow the query with namespace ...]\n", len(releases)-maxListedHelmReleases)
			break
		}
		hr := helmutil.ToHelmRelease(rel, false)
		updated := ""
		if hr.Status.LastDeployed != nil {
			updated = hr.Status.LastDeployed.Format(time.RFC3339)
		}
		fmt.Fprintf(&sb, "- %s/%s: chart=%s appVersion=%s status=%s revision=%d updated=%s\n",
			hr.Namespace, hr.Name, hr.Spec.Chart, hr.Spec.AppVersion, hr.Status.Status, hr.Spec.Revision, updated)
	}
	return sb.String(), false
}

func executeGetHelmRelease(_ context.Context, cs *cluster.ClientSet, args map[string]interface{}) (string, bool) {
	name, err := getRequiredString(args, "name")
	if err != nil {
		return "Error: " + err.Error(), true
	}
	namespace, err := getRequiredString(args, "namespace")
	if err != nil {
		return "Error: " + err.Error(), true
	}
	includeDefaults, _ := args["include_default_values"].(bool)

	cfg, err := helmActionConfig(cs, namespace)
	if err != nil {
		return fmt.Sprintf("Error building Helm client: %v", err), true
	}
	rel, err := helmutil.GetRelease(cfg, name)
	if err != nil {
		return fmt.Sprintf("Error getting Helm release %s/%s: %v", namespace, name, err), true
	}
	hr := helmutil.ToHelmRelease(rel, true)

	var sb strings.Builder
	fmt.Fprintf(&sb, "Name: %s\nNamespace: %s\nChart: %s\nChart version: %s\nApp version: %s\nStatus: %s\nRevision: %d\n",
		hr.Name, hr.Namespace, hr.Spec.ChartName, hr.Spec.ChartVersion, hr.Spec.AppVersion, hr.Status.Status, hr.Spec.Revision)
	if hr.Status.FirstDeployed != nil {
		fmt.Fprintf(&sb, "First deployed: %s\n", hr.Status.FirstDeployed.Format(time.RFC3339))
	}
	if hr.Status.LastDeployed != nil {
		fmt.Fprintf(&sb, "Last deployed: %s\n", hr.Status.LastDeployed.Format(time.RFC3339))
	}
	if hr.Spec.Description != "" {
		fmt.Fprintf(&sb, "Description: %s\n", hr.Spec.Description)
	}

	if len(hr.Status.Resources) > 0 {
		fmt.Fprintf(&sb, "\nManaged resources (%d):\n", len(hr.Status.Resources))
		for i, resource := range hr.Status.Resources {
			if i >= maxHelmManagedResources {
				fmt.Fprintf(&sb, "[... %d more resources omitted ...]\n", len(hr.Status.Resources)-maxHelmManagedResources)
				break
			}
			target := resource.Name
			if resource.Namespace != "" {
				target = resource.Namespace + "/" + resource.Name
			}
			fmt.Fprintf(&sb, "- %s %s\n", resource.Kind, target)
		}
	}

	sb.WriteString("\nUser-supplied values:\n")
	writeHelmValuesYAML(&sb, hr.Spec.Values)
	if includeDefaults {
		sb.WriteString("\nChart default values:\n")
		writeHelmValuesYAML(&sb, hr.Spec.DefaultValues)
	}
	// Rendered chart notes are deliberately omitted: NOTES.txt is templated
	// with the real values, so it would leak what redactHelmValues masks.
	return sb.String(), false
}

func writeHelmValuesYAML(sb *strings.Builder, values map[string]interface{}) {
	if len(values) == 0 {
		sb.WriteString("(none)\n")
		return
	}
	data, err := yaml.Marshal(redactHelmValues(values))
	if err != nil {
		fmt.Fprintf(sb, "(failed to render values: %v)\n", err)
		return
	}
	sb.WriteString(strings.TrimRight(truncateWithNotice(string(data), maxHelmValuesChars, "helm values"), "\n"))
	sb.WriteString("\n")
}

func redactHelmValues(values map[string]interface{}) map[string]interface{} {
	redacted, _ := redactHelmValueNode(values, false).(map[string]interface{})
	return redacted
}

func redactHelmValueNode(value interface{}, sensitive bool) interface{} {
	switch typed := value.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(typed))
		for key, nested := range typed {
			out[key] = redactHelmValueNode(nested, sensitive || sensitiveHelmValueKey(key))
		}
		return out
	case []interface{}:
		out := make([]interface{}, len(typed))
		for i, nested := range typed {
			out[i] = redactHelmValueNode(nested, sensitive)
		}
		return out
	default:
		if sensitive && value != nil {
			return redactedValuePlaceholder
		}
		return value
	}
}

func sensitiveHelmValueKey(key string) bool {
	lower := strings.ToLower(key)
	if lower == "pass" || strings.HasSuffix(lower, "_pass") || strings.HasSuffix(lower, "-pass") || strings.HasSuffix(lower, ".pass") {
		return true
	}
	normalized := helmValueKeyNormalizer.Replace(lower)
	for _, marker := range exemptHelmValueKeyMarkers {
		if strings.Contains(normalized, marker) {
			return false
		}
	}
	for _, marker := range sensitiveHelmValueKeyMarkers {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return false
}

func containsRedactedHelmValue(value interface{}) bool {
	switch typed := value.(type) {
	case map[string]interface{}:
		for _, nested := range typed {
			if containsRedactedHelmValue(nested) {
				return true
			}
		}
	case []interface{}:
		for _, nested := range typed {
			if containsRedactedHelmValue(nested) {
				return true
			}
		}
	case string:
		return typed == redactedValuePlaceholder
	}
	return false
}

func helmRevisionFromArgs(args map[string]interface{}) (int, error) {
	raw, ok := args["revision"]
	if !ok || raw == nil {
		return 0, nil
	}
	revision, ok := raw.(float64)
	if !ok || revision != math.Trunc(revision) || revision < 1 || revision > math.MaxInt32 {
		return 0, fmt.Errorf("revision must be a positive integer")
	}
	return int(revision), nil
}

func executeGetHelmReleaseHistory(_ context.Context, cs *cluster.ClientSet, args map[string]interface{}) (string, bool) {
	name, err := getRequiredString(args, "name")
	if err != nil {
		return "Error: " + err.Error(), true
	}
	namespace, err := getRequiredString(args, "namespace")
	if err != nil {
		return "Error: " + err.Error(), true
	}

	cfg, err := helmActionConfig(cs, namespace)
	if err != nil {
		return fmt.Sprintf("Error building Helm client: %v", err), true
	}
	items, err := helmutil.ReleaseHistoryItems(cfg, name)
	if err != nil {
		return fmt.Sprintf("Error getting history of Helm release %s/%s: %v", namespace, name, err), true
	}
	if len(items) == 0 {
		return fmt.Sprintf("No history found for Helm release %s/%s", namespace, name), false
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "History of Helm release %s/%s (%d revision(s), newest first):\n", namespace, name, len(items))
	for i, item := range items {
		if i >= maxHelmHistoryItems {
			fmt.Fprintf(&sb, "[... %d older revisions omitted ...]\n", len(items)-maxHelmHistoryItems)
			break
		}
		updated := ""
		if item.LastDeployed != nil {
			updated = item.LastDeployed.Format(time.RFC3339)
		}
		fmt.Fprintf(&sb, "- revision %d: status=%s chart=%s appVersion=%s updated=%s description=%s\n",
			item.Revision, item.Status, item.Chart, item.AppVersion, updated, item.Description)
	}
	return sb.String(), false
}

func executeUpdateHelmReleaseValues(ctx context.Context, cs *cluster.ClientSet, user pkgmodel.User, args map[string]interface{}) (string, bool) {
	name, err := getRequiredString(args, "name")
	if err != nil {
		return "Error: " + err.Error(), true
	}
	namespace, err := getRequiredString(args, "namespace")
	if err != nil {
		return "Error: " + err.Error(), true
	}
	valuesYAML, err := getRequiredString(args, "values_yaml")
	if err != nil {
		return "Error: " + err.Error(), true
	}
	values := map[string]interface{}{}
	if err := yaml.Unmarshal([]byte(valuesYAML), &values); err != nil {
		return fmt.Sprintf("Error parsing values_yaml: %v", err), true
	}
	if len(values) == 0 {
		// Helm reuses the previous values when the new set is empty, so an
		// empty mapping can neither reset to chart defaults nor change state.
		return "Error: values_yaml must contain at least one field; resetting a release to chart defaults is not supported", true
	}
	if containsRedactedHelmValue(values) {
		return fmt.Sprintf("Error: values_yaml contains the masked placeholder %q copied from get_helm_release output. In the default merge mode, omit those fields to keep their current values; with replace=true, provide their real values because omitted fields are removed", redactedValuePlaceholder), true
	}
	replace := false
	if raw, ok := args["replace"]; ok && raw != nil {
		if replace, ok = raw.(bool); !ok {
			return "Error: replace must be a boolean", true
		}
	}

	cfg, err := helmActionConfig(cs, namespace)
	if err != nil {
		return fmt.Sprintf("Error building Helm client: %v", err), true
	}
	current, err := helmutil.GetRelease(cfg, name)
	if err != nil {
		return fmt.Sprintf("Error getting Helm release %s/%s: %v", namespace, name, err), true
	}
	if current.Chart == nil {
		return fmt.Sprintf("Error: Helm release %s/%s has no chart recorded", namespace, name), true
	}

	rel, err := helmutil.UpgradeRelease(ctx, cfg, name, current.Chart, values, helmutil.UpgradeReleaseOptions{
		Namespace:   namespace,
		Timeout:     helmToolTimeout,
		ReuseValues: !replace,
		Description: "Values update requested from Kite AI",
	})
	helmutil.RecordReleaseHistory(cs.Name, user.ID, "ai", "upgrade", name, namespace, current, rel, err == nil, err)
	if err != nil {
		return fmt.Sprintf("Error updating values of Helm release %s/%s: %v", namespace, name, err), true
	}

	klog.V(1).Infof("AI Agent updated helm release values: %s/%s", namespace, name)
	return fmt.Sprintf("Successfully updated values of Helm release %s/%s (new revision %d)", namespace, name, rel.Version), false
}

func executeRollbackHelmRelease(_ context.Context, cs *cluster.ClientSet, user pkgmodel.User, args map[string]interface{}) (string, bool) {
	name, err := getRequiredString(args, "name")
	if err != nil {
		return "Error: " + err.Error(), true
	}
	namespace, err := getRequiredString(args, "namespace")
	if err != nil {
		return "Error: " + err.Error(), true
	}

	cfg, err := helmActionConfig(cs, namespace)
	if err != nil {
		return fmt.Sprintf("Error building Helm client: %v", err), true
	}
	current, err := helmutil.GetRelease(cfg, name)
	if err != nil {
		return fmt.Sprintf("Error getting Helm release %s/%s: %v", namespace, name, err), true
	}

	targetRevision, err := helmRevisionFromArgs(args)
	if err != nil {
		return "Error: " + err.Error(), true
	}
	if targetRevision == 0 {
		targetRevision = current.Version - 1
	}
	if targetRevision <= 0 {
		err = fmt.Errorf("no previous revision found for Helm release %s/%s", namespace, name)
		helmutil.RecordReleaseHistory(cs.Name, user.ID, "ai", "rollback", name, namespace, current, nil, false, err)
		return "Error: " + err.Error(), true
	}

	err = helmutil.RollbackRelease(cfg, name, helmutil.RollbackReleaseOptions{
		Version: targetRevision,
		Timeout: helmToolTimeout,
	})
	var next *release.Release
	if err == nil {
		var getErr error
		if next, getErr = helmutil.GetRelease(cfg, name); getErr != nil {
			klog.Errorf("Failed to read rolled back helm release: %v", getErr)
		}
	}
	helmutil.RecordReleaseHistory(cs.Name, user.ID, "ai", "rollback", name, namespace, current, next, err == nil, err)
	if err != nil {
		return fmt.Sprintf("Error rolling back Helm release %s/%s: %v", namespace, name, err), true
	}

	klog.V(1).Infof("AI Agent rolled back helm release: %s/%s to revision %d", namespace, name, targetRevision)
	result := fmt.Sprintf("Successfully rolled back Helm release %s/%s to revision %d", namespace, name, targetRevision)
	if next != nil {
		result += fmt.Sprintf(" (new revision %d)", next.Version)
	}
	return result, false
}

func executeUninstallHelmRelease(_ context.Context, cs *cluster.ClientSet, user pkgmodel.User, args map[string]interface{}) (string, bool) {
	name, err := getRequiredString(args, "name")
	if err != nil {
		return "Error: " + err.Error(), true
	}
	namespace, err := getRequiredString(args, "namespace")
	if err != nil {
		return "Error: " + err.Error(), true
	}

	cfg, err := helmActionConfig(cs, namespace)
	if err != nil {
		return fmt.Sprintf("Error building Helm client: %v", err), true
	}
	current, err := helmutil.GetRelease(cfg, name)
	if err != nil {
		return fmt.Sprintf("Error getting Helm release %s/%s: %v", namespace, name, err), true
	}

	err = helmutil.UninstallRelease(cfg, name, helmutil.UninstallReleaseOptions{
		Timeout:     helmToolTimeout,
		Description: "Uninstalled from Kite AI",
	})
	helmutil.RecordReleaseHistory(cs.Name, user.ID, "ai", "delete", name, namespace, current, nil, err == nil, err)
	if err != nil {
		return fmt.Sprintf("Error uninstalling Helm release %s/%s: %v", namespace, name, err), true
	}
	if err := scheduler.DeleteHelmReleaseAutoUpgradeTask(cs.Name, current.Namespace, current.Name); err != nil {
		klog.Errorf("Failed to delete helm release auto upgrade task: %v", err)
	}

	klog.V(1).Infof("AI Agent uninstalled helm release: %s/%s", namespace, name)
	return fmt.Sprintf("Successfully uninstalled Helm release %s/%s", namespace, name), false
}
