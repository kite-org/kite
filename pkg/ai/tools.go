package ai

import (
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
			Description: "Get a specific Kubernetes resource by kind, name, and optionally namespace. Returns the resource details in YAML format.",
			Properties: map[string]any{
				"kind": map[string]any{
					"type":        "string",
					"description": "The resource kind, e.g. Pod, Deployment, Service, ConfigMap, Secret, Node, Namespace, StatefulSet, DaemonSet, Job, CronJob, Ingress, PersistentVolumeClaim, etc.",
				},
				"name": map[string]any{
					"type":        "string",
					"description": "The name of the resource.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "The namespace of the resource. Leave empty for cluster-scoped resources like Node, Namespace.",
				},
			},
			Required: []string{"kind", "name"},
		},
		{
			Name:        "list_resources",
			Description: "List Kubernetes resources of a given kind, optionally filtered by namespace and label selector. Returns a summary of matching resources.",
			Properties: map[string]any{
				"kind": map[string]any{
					"type":        "string",
					"description": "The resource kind, e.g. Pod, Deployment, Service, ConfigMap, Node, Namespace, etc.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "The namespace to list resources in. Leave empty for all namespaces or cluster-scoped resources.",
				},
				"label_selector": map[string]any{
					"type":        "string",
					"description": "Optional label selector to filter resources, e.g. 'app=nginx' or 'environment=production'.",
				},
			},
			Required: []string{"kind"},
		},
		{
			Name:        "get_pod_logs",
			Description: "Get recent logs from a pod. Useful for debugging issues or analyzing application behavior.",
			Properties: map[string]any{
				"name": map[string]any{
					"type":        "string",
					"description": "The name of the pod.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "The namespace of the pod.",
				},
				"container": map[string]any{
					"type":        "string",
					"description": "The container name. Leave empty for the default container.",
				},
				"tail_lines": map[string]any{
					"type":        "integer",
					"description": "Number of recent log lines to retrieve. Defaults to 100.",
				},
				"previous": map[string]any{
					"type":        "boolean",
					"description": "If true, return logs from the previous terminated container instance.",
				},
			},
			Required: []string{"name", "namespace"},
		},
		{
			Name:        "get_cluster_overview",
			Description: "Get an overview of the cluster status including node count, pod count, namespaces, and resource usage summary.",
			Properties:  map[string]any{},
		},
		{
			Name:        "create_resource",
			Description: "Create a Kubernetes resource from a YAML definition.",
			Properties: map[string]any{
				"yaml": map[string]any{
					"type":        "string",
					"description": "The YAML definition of the resource to create.",
				},
			},
			Required: []string{"yaml"},
		},
		{
			Name:        "update_resource",
			Description: "Update an existing Kubernetes resource with a new YAML definition.",
			Properties: map[string]any{
				"yaml": map[string]any{
					"type":        "string",
					"description": "The updated YAML definition of the resource.",
				},
			},
			Required: []string{"yaml"},
		},
		{
			Name:        "patch_resource",
			Description: "Patch a Kubernetes resource using strategic merge patch. Useful for partial updates like scaling replicas, updating labels/annotations, restarting deployments (by patching pod template annotations), changing image versions, etc.",
			Properties: map[string]any{
				"kind": map[string]any{
					"type":        "string",
					"description": "The resource kind (e.g. Deployment, StatefulSet, Service).",
				},
				"name": map[string]any{
					"type":        "string",
					"description": "The name of the resource.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "The namespace of the resource. Leave empty for cluster-scoped resources.",
				},
				"patch": map[string]any{
					"type":        "string",
					"description": "The JSON patch content (strategic merge patch). Example: {\"spec\":{\"replicas\":3}} to scale, or {\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"kubectl.kubernetes.io/restartedAt\":\"2024-01-01T00:00:00Z\"}}}}} to restart.",
				},
			},
			Required: []string{"kind", "name", "patch"},
		},
		{
			Name:        "delete_resource",
			Description: "Delete a Kubernetes resource.",
			Properties: map[string]any{
				"kind": map[string]any{
					"type":        "string",
					"description": "The resource kind.",
				},
				"name": map[string]any{
					"type":        "string",
					"description": "The name of the resource.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "The namespace of the resource. Leave empty for cluster-scoped resources.",
				},
			},
			Required: []string{"kind", "name"},
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
					"description": "Time range for range queries. Examples: '30m', '1h', '24h'. Only used when query_type is 'range'. Defaults to '1h'.",
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

func OpenAIToolDefs(cs *cluster.ClientSet) []openai.ChatCompletionToolParam {
	defs := toolDefinitions(cs)
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

func AnthropicToolDefs(cs *cluster.ClientSet) []anthropic.ToolUnionParam {
	defs := toolDefinitions(cs)
	tools := make([]anthropic.ToolUnionParam, 0, len(defs))

	for _, def := range defs {
		tool := anthropic.ToolParam{
			Name:        def.Name,
			Description: anthropic.String(def.Description),
			InputSchema: anthropic.ToolInputSchemaParam{
				Type:       "object",
				Properties: def.Properties,
				Required:   def.Required,
			},
		}
		tools = append(tools, anthropic.ToolUnionParam{OfTool: &tool})
	}

	return tools
}
