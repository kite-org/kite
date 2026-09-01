package ai

import (
	"fmt"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/openai/openai-go"
	"github.com/openai/openai-go/shared"
	"github.com/zxh326/kite/pkg/cluster"
)

type agentToolDefinition struct {
	Name        string
	Description string
	Properties  map[string]any
	Required    []string
}

func toolDefinitions(cs *cluster.ClientSet) []agentToolDefinition {
	tools := []agentToolDefinition{
		{
			Name:        requestChoiceTool,
			Description: "Pause the conversation and ask the user to pick one option by clicking. Use this instead of a free-form follow-up question when the next step is a short list of known choices. Do not use this for the final confirmation of create/update/patch/delete actions; mutation tools already trigger their own confirmation UI.",
			Properties: map[string]any{
				"name": map[string]any{
					"type":        "string",
					"description": "The field name for the selected value, e.g. resourceType or namespace.",
				},
				"title": map[string]any{
					"type":        "string",
					"description": "Short prompt shown above the options.",
				},
				"description": map[string]any{
					"type":        "string",
					"description": "Optional extra context to help the user choose.",
				},
				"options": interactionOptionsSchema("The clickable options."),
			},
			Required: []string{"name", "title", "options"},
		},
		{
			Name:        requestFormTool,
			Description: "Pause the conversation and ask the user to fill a small structured form. Use this for resource creation or updates when a few predictable inputs are needed. Do not use this as a final confirmation step before create/update/patch/delete; collect inputs, then call the mutation tool directly.",
			Properties: map[string]any{
				"title": map[string]any{
					"type":        "string",
					"description": "Short form title shown to the user.",
				},
				"description": map[string]any{
					"type":        "string",
					"description": "Optional context describing why these fields are needed.",
				},
				"submit_label": map[string]any{
					"type":        "string",
					"description": "Optional custom submit button label.",
				},
				"fields": map[string]any{
					"type":        "array",
					"description": "Form fields to collect. Keep the form short and ask only for the minimum required inputs.",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"name": map[string]any{
								"type":        "string",
								"description": "Field key returned in the submitted values object.",
							},
							"label": map[string]any{
								"type":        "string",
								"description": "Field label shown to the user.",
							},
							"type": map[string]any{
								"type":        "string",
								"description": "Field type.",
								"enum":        []string{"text", "number", "textarea", "select", "switch"},
							},
							"required": map[string]any{
								"type":        "boolean",
								"description": "Whether the field must be provided.",
							},
							"placeholder": map[string]any{
								"type":        "string",
								"description": "Optional placeholder text.",
							},
							"description": map[string]any{
								"type":        "string",
								"description": "Optional short helper text.",
							},
							"default_value": map[string]any{
								"type":        "string",
								"description": "Optional default value as a string. For switch use 'true' or 'false'.",
							},
							"options": interactionOptionsSchema("Options for select fields."),
						},
						"required": []string{"name", "label", "type"},
					},
				},
			},
			Required: []string{"title", "fields"},
		},
		{
			Name:        "get_resource",
			Description: "Get one Kubernetes resource as YAML. Pass kind, name, and namespace as separate fields; never put namespace in name.",
			Properties: map[string]any{
				"kind": map[string]any{
					"type":        "string",
					"description": "Resource kind, such as Pod, Deployment, Service, Node, or widgets.example.com.",
				},
				"name": map[string]any{
					"type":        "string",
					"description": "Resource name without a namespace prefix.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "Namespace for a namespaced resource. Omit for cluster-scoped resources.",
				},
			},
			Required: []string{"kind", "name"},
		},
		{
			Name:        "list_resources",
			Description: fmt.Sprintf("List Kubernetes resources of a given kind, optionally filtered by namespace and label selector. Returns a summary of matching resources, capped at %d items — narrow the query with namespace or label_selector when more are expected.", maxListedResourceItems),
			Properties: map[string]any{
				"kind": map[string]any{
					"type":        "string",
					"description": "Resource kind, such as Pod, Deployment, Service, Node, Event, or widgets.example.com.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "Namespace to list. Omit to list all namespaces or for cluster-scoped resources.",
				},
				"label_selector": map[string]any{
					"type":        "string",
					"description": "Optional Kubernetes label selector, such as app=nginx.",
				},
			},
			Required: []string{"kind"},
		},
		{
			Name:        "describe_resource",
			Description: "Describe one Kubernetes resource, including related events when supported. Pass kind, name, and namespace as separate fields; never put namespace in name.",
			Properties: map[string]any{
				"kind": map[string]any{
					"type":        "string",
					"description": "Resource kind, such as Pod, Deployment, Service, or Node.",
				},
				"name": map[string]any{
					"type":        "string",
					"description": "Resource name without a namespace prefix.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "Namespace for a namespaced resource. Omit for cluster-scoped resources.",
				},
			},
			Required: []string{"kind", "name"},
		},
		{
			Name:        "get_pod_logs",
			Description: "Get recent logs from one Pod. The pod name and namespace are separate required fields.",
			Properties: map[string]any{
				"name": map[string]any{
					"type":        "string",
					"description": "Pod name without a namespace prefix.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "Pod namespace.",
				},
				"container": map[string]any{
					"type":        "string",
					"description": "Optional container name.",
				},
				"tail_lines": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"maximum":     maxPodLogTailLines,
					"description": fmt.Sprintf("Number of recent log lines to retrieve. Defaults to 100, maximum %d. Output is additionally capped at %d KB; request a smaller window to read a specific section.", maxPodLogTailLines, maxPodLogBytes/1024),
				},
				"previous": map[string]any{
					"type":        "boolean",
					"description": "Return logs from the previous terminated container instance.",
				},
			},
			Required: []string{"name", "namespace"},
		},
		{
			Name:        "exec_in_pod",
			Description: "Run one non-interactive command in a Pod container and return stdout and stderr. Pass the executable and arguments as an array. Shell syntax is not interpreted unless the command explicitly invokes a shell. The command has no stdin or TTY and requires user confirmation.",
			Properties: map[string]any{
				"name": map[string]any{
					"type":        "string",
					"description": "Pod name without a namespace prefix.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "Pod namespace.",
				},
				"container": map[string]any{
					"type":        "string",
					"description": "Optional container name.",
				},
				"command": map[string]any{
					"type":        "array",
					"description": "Executable and arguments, one item per argument. Example: [\"cat\", \"/etc/os-release\"].",
					"items":       map[string]any{"type": "string"},
				},
				"timeout_seconds": map[string]any{
					"type":        "integer",
					"description": "Positive command timeout in seconds. Choose a duration appropriate for the command.",
				},
			},
			Required: []string{"name", "namespace", "command", "timeout_seconds"},
		},
		{
			Name:        "get_cluster_overview",
			Description: "Get a compact overview of cluster nodes, pods, namespaces, and services. Use this as the first step for a broad cluster health check.",
			Properties:  map[string]any{},
		},
		{
			Name:        "apply_resource",
			Description: "Create or update one Kubernetes resource with Server-Side Apply. Pass one complete YAML document. This is a mutation and requires user confirmation.",
			Properties: map[string]any{
				"yaml": map[string]any{
					"type":        "string",
					"description": "One complete Kubernetes YAML document containing apiVersion, kind, metadata.name, and metadata.namespace when namespaced.",
				},
			},
			Required: []string{"yaml"},
		},
		{
			Name:        "patch_resource",
			Description: "Patch one Kubernetes resource. Use this for focused changes such as scaling, restarting a workload, or changing an image. This is a mutation and requires user confirmation.",
			Properties: map[string]any{
				"kind": map[string]any{
					"type":        "string",
					"description": "Resource kind, such as Deployment, StatefulSet, or Service.",
				},
				"name": map[string]any{
					"type":        "string",
					"description": "Resource name without a namespace prefix.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "Namespace for a namespaced resource. Omit for cluster-scoped resources.",
				},
				"patch": map[string]any{
					"type":        "string",
					"description": "JSON-encoded patch document.",
				},
				"patch_type": map[string]any{
					"type":        "string",
					"description": "Patch format. Defaults to strategic.",
					"enum":        []string{"strategic", "merge", "json"},
				},
			},
			Required: []string{"kind", "name", "patch"},
		},
		{
			Name:        "delete_resource",
			Description: "Delete one Kubernetes resource. This is a mutation and requires user confirmation.",
			Properties: map[string]any{
				"kind": map[string]any{
					"type":        "string",
					"description": "Resource kind.",
				},
				"name": map[string]any{
					"type":        "string",
					"description": "Resource name without a namespace prefix.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "Namespace for a namespaced resource. Omit for cluster-scoped resources.",
				},
			},
			Required: []string{"kind", "name"},
		},
		{
			Name:        "list_helm_releases",
			Description: fmt.Sprintf("List Helm releases, optionally filtered by namespace. Returns name, namespace, chart, app version, status, revision, and last update time, capped at %d items. Listing without a namespace requires access to all namespaces.", maxListedHelmReleases),
			Properties: map[string]any{
				"namespace": map[string]any{
					"type":        "string",
					"description": "The namespace to list releases in. Leave empty for all namespaces.",
				},
			},
		},
		{
			Name:        "get_helm_release",
			Description: fmt.Sprintf("Get details of a Helm release: chart info, status, revision, managed resources, and the user-supplied values (overrides). Set include_default_values to true to also return the chart's default values. Sensitive-looking values (passwords, tokens, keys) are masked as %q.", redactedValuePlaceholder),
			Properties: map[string]any{
				"name": map[string]any{
					"type":        "string",
					"description": "The release name.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "The namespace of the release.",
				},
				"include_default_values": map[string]any{
					"type":        "boolean",
					"description": "If true, also return the chart's default values. Defaults to false.",
				},
			},
			Required: []string{"name", "namespace"},
		},
		{
			Name:        "get_helm_release_history",
			Description: fmt.Sprintf("Get the revision history of a Helm release, newest first, capped at %d revisions. Useful before rollback_helm_release to pick the target revision.", maxHelmHistoryItems),
			Properties: map[string]any{
				"name": map[string]any{
					"type":        "string",
					"description": "The release name.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "The namespace of the release.",
				},
			},
			Required: []string{"name", "namespace"},
		},
		{
			Name:        "update_helm_release_values",
			Description: fmt.Sprintf("Update the values of a Helm release and redeploy it with its current chart version. By default values_yaml is MERGED over the existing user-supplied values (like helm upgrade --reuse-values), so pass only the fields to change. Set replace to true to instead replace the entire set of user-supplied values with values_yaml. Does not change the chart version. Values masked as %q in get_helm_release output are rejected and must not be written back.", redactedValuePlaceholder),
			Properties: map[string]any{
				"name": map[string]any{
					"type":        "string",
					"description": "The release name.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "The namespace of the release.",
				},
				"values_yaml": map[string]any{
					"type":        "string",
					"description": "The values to apply as YAML. By default merged over the existing user-supplied values; with replace=true it becomes the complete new set of user-supplied values.",
				},
				"replace": map[string]any{
					"type":        "boolean",
					"description": "If true, replace all user-supplied values with values_yaml instead of merging; omitted fields are removed from the release. Defaults to false.",
				},
			},
			Required: []string{"name", "namespace", "values_yaml"},
		},
		{
			Name:        "rollback_helm_release",
			Description: "Roll back a Helm release to a previous revision. When revision is omitted, rolls back to the immediately previous revision.",
			Properties: map[string]any{
				"name": map[string]any{
					"type":        "string",
					"description": "The release name.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "The namespace of the release.",
				},
				"revision": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "The target revision to roll back to. Defaults to the previous revision.",
				},
			},
			Required: []string{"name", "namespace"},
		},
		{
			Name:        "uninstall_helm_release",
			Description: "Uninstall a Helm release and delete all resources it manages.",
			Properties: map[string]any{
				"name": map[string]any{
					"type":        "string",
					"description": "The release name.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "The namespace of the release.",
				},
			},
			Required: []string{"name", "namespace"},
		},
	}

	// Only add Prometheus tool if Prometheus client is available
	if cs != nil && cs.PromClient != nil {
		tools = append(tools, agentToolDefinition{
			Name:        "query_prometheus",
			Description: "Execute a PromQL query against Prometheus to retrieve metrics data. Use this to get monitoring information like CPU usage, memory usage, network traffic, custom application metrics, etc. Returns time series data or instant values. Note: Requires cluster-wide read access as metrics can span multiple namespaces.",
			Properties: map[string]any{
				"query": map[string]any{
					"type":        "string",
					"description": "The PromQL query expression. Examples: 'up', 'rate(container_cpu_usage_seconds_total[5m])', 'node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes * 100'",
				},
				"query_type": map[string]any{
					"type":        "string",
					"description": "Type of query: 'instant' for current values or 'range' for time series data over a period. Defaults to 'instant'.",
					"enum":        []string{"instant", "range"},
				},
				"duration": map[string]any{
					"type":        "string",
					"description": "Positive Prometheus duration for range queries, such as '30m', '6h', '24h', or '7d'. Defaults to '1h'.",
				},
			},
			Required: []string{"query"},
		})
	}

	return tools
}

func interactionOptionsSchema(description string) map[string]any {
	return map[string]any{
		"type":        "array",
		"description": description,
		"items": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"label": map[string]any{
					"type":        "string",
					"description": "User-facing label.",
				},
				"value": map[string]any{
					"type":        "string",
					"description": "Submitted value.",
				},
				"description": map[string]any{
					"type":        "string",
					"description": "Optional short helper text.",
				},
			},
			"required": []string{"label", "value"},
		},
	}
}

func OpenAIToolDefs(defs []agentToolDefinition) []openai.ChatCompletionToolParam {
	tools := make([]openai.ChatCompletionToolParam, 0, len(defs))

	for _, def := range defs {
		parameters := shared.FunctionParameters{
			"type":       "object",
			"properties": def.Properties,
		}
		if len(def.Required) > 0 {
			parameters["required"] = def.Required
		}

		tools = append(tools, openai.ChatCompletionToolParam{
			Function: shared.FunctionDefinitionParam{
				Name:        def.Name,
				Description: openai.String(def.Description),
				Parameters:  parameters,
			},
		})
	}

	return tools
}

// AnthropicToolDefs builds tool definitions for the Beta Messages API, which the
// Anthropic path uses so it can enable context management (context editing)
// alongside tool use.
func AnthropicToolDefs(defs []agentToolDefinition) []anthropic.BetaToolUnionParam {
	tools := make([]anthropic.BetaToolUnionParam, 0, len(defs))

	for _, def := range defs {
		tool := anthropic.BetaToolParam{
			Name:        def.Name,
			Description: anthropic.String(def.Description),
			InputSchema: anthropic.BetaToolInputSchemaParam{
				Properties: def.Properties,
				Required:   def.Required,
			},
		}
		tools = append(tools, anthropic.BetaToolUnionParam{OfTool: &tool})
	}

	return tools
}
