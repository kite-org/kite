package utils

import "strings"

var searchResourceAliases = map[string]string{
	"po":                     "pods",
	"pod":                    "pods",
	"pods":                   "pods",
	"svc":                    "services",
	"service":                "services",
	"services":               "services",
	"pv":                     "persistentvolumes",
	"persistentvolume":       "persistentvolumes",
	"persistentvolumes":      "persistentvolumes",
	"pvc":                    "persistentvolumeclaims",
	"persistentvolumeclaim":  "persistentvolumeclaims",
	"persistentvolumeclaims": "persistentvolumeclaims",
	"cm":                     "configmaps",
	"configmap":              "configmaps",
	"configmaps":             "configmaps",
	"secret":                 "secrets",
	"secrets":                "secrets",
	"dep":                    "deployments",
	"deploy":                 "deployments",
	"deployment":             "deployments",
	"deployments":            "deployments",
	"ds":                     "daemonsets",
	"daemonset":              "daemonsets",
	"daemonsets":             "daemonsets",
	"statefulset":            "statefulsets",
	"statefulsets":           "statefulsets",
	"job":                    "jobs",
	"jobs":                   "jobs",
	"cronjob":                "cronjobs",
	"cronjobs":               "cronjobs",
}

func GuessSearchResources(query string) (string, string) {
	parts := strings.Fields(query)
	if len(parts) < 2 {
		return "all", strings.TrimSpace(query)
	}

	resource, ok := searchResourceAliases[strings.ToLower(parts[0])]
	if !ok {
		return "all", strings.Join(parts, " ")
	}

	return resource, strings.Join(parts[1:], " ")
}
