package ai

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

const (
	requestChoiceTool     = "request_choice"
	requestFormTool       = "request_form"
	interactionKindChoice = "choice"
	interactionKindForm   = "form"
)

var InteractionTools = map[string]bool{
	requestChoiceTool: true,
	requestFormTool:   true,
}

var supportedInteractionFieldTypes = map[string]bool{
	"text":     true,
	"number":   true,
	"textarea": true,
	"select":   true,
	"switch":   true,
}

type interactionOption struct {
	Label       string `json:"label"`
	Value       string `json:"value"`
	Description string `json:"description,omitempty"`
}

type interactionField struct {
	Name         string              `json:"name"`
	Label        string              `json:"label"`
	Type         string              `json:"type"`
	Required     bool                `json:"required,omitempty"`
	Placeholder  string              `json:"placeholder,omitempty"`
	Description  string              `json:"description,omitempty"`
	DefaultValue string              `json:"default_value,omitempty"`
	Options      []interactionOption `json:"options,omitempty"`
}

type interactionRequest struct {
	Kind        string              `json:"kind"`
	Name        string              `json:"name,omitempty"`
	Title       string              `json:"title"`
	Description string              `json:"description,omitempty"`
	SubmitLabel string              `json:"submit_label,omitempty"`
	Options     []interactionOption `json:"options,omitempty"`
	Fields      []interactionField  `json:"fields,omitempty"`
}

func parseInteractionRequest(toolName string, args map[string]interface{}) (interactionRequest, error) {
	switch toolName {
	case requestChoiceTool:
		name, err := getRequiredString(args, "name")
		if err != nil {
			return interactionRequest{}, err
		}
		title, err := getRequiredString(args, "title")
		if err != nil {
			return interactionRequest{}, err
		}
		options, err := parseInteractionOptions(args["options"])
		if err != nil {
			return interactionRequest{}, err
		}
		if len(options) == 0 {
			return interactionRequest{}, fmt.Errorf("options must include at least one choice")
		}
		description, _ := args["description"].(string)
		return interactionRequest{
			Kind:        interactionKindChoice,
			Name:        name,
			Title:       strings.TrimSpace(title),
			Description: strings.TrimSpace(description),
			Options:     options,
		}, nil
	case requestFormTool:
		title, err := getRequiredString(args, "title")
		if err != nil {
			return interactionRequest{}, err
		}
		fields, err := parseInteractionFields(args["fields"])
		if err != nil {
			return interactionRequest{}, err
		}
		if len(fields) == 0 {
			return interactionRequest{}, fmt.Errorf("fields must include at least one item")
		}
		description, _ := args["description"].(string)
		submitLabel, _ := args["submit_label"].(string)
		return interactionRequest{
			Kind:        interactionKindForm,
			Title:       strings.TrimSpace(title),
			Description: strings.TrimSpace(description),
			SubmitLabel: strings.TrimSpace(submitLabel),
			Fields:      fields,
		}, nil
	default:
		return interactionRequest{}, fmt.Errorf("unsupported interaction tool %s", toolName)
	}
}

func parseInteractionOptions(raw interface{}) ([]interactionOption, error) {
	items, ok := raw.([]interface{})
	if !ok {
		return nil, fmt.Errorf("options must be an array")
	}

	options := make([]interactionOption, 0, len(items))
	for idx, item := range items {
		optionMap, ok := item.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("options[%d] must be an object", idx)
		}
		label, err := getRequiredString(optionMap, "label")
		if err != nil {
			return nil, fmt.Errorf("options[%d].%s", idx, err.Error())
		}
		value, err := getRequiredString(optionMap, "value")
		if err != nil {
			return nil, fmt.Errorf("options[%d].%s", idx, err.Error())
		}
		description, _ := optionMap["description"].(string)
		options = append(options, interactionOption{
			Label:       label,
			Value:       value,
			Description: strings.TrimSpace(description),
		})
	}

	return options, nil
}

func parseInteractionFields(raw interface{}) ([]interactionField, error) {
	items, ok := raw.([]interface{})
	if !ok {
		return nil, fmt.Errorf("fields must be an array")
	}

	fields := make([]interactionField, 0, len(items))
	for idx, item := range items {
		fieldMap, ok := item.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("fields[%d] must be an object", idx)
		}
		name, err := getRequiredString(fieldMap, "name")
		if err != nil {
			return nil, fmt.Errorf("fields[%d].%s", idx, err.Error())
		}
		label, err := getRequiredString(fieldMap, "label")
		if err != nil {
			return nil, fmt.Errorf("fields[%d].%s", idx, err.Error())
		}
		fieldType, err := getRequiredString(fieldMap, "type")
		if err != nil {
			return nil, fmt.Errorf("fields[%d].%s", idx, err.Error())
		}
		fieldType = strings.ToLower(strings.TrimSpace(fieldType))
		if !supportedInteractionFieldTypes[fieldType] {
			return nil, fmt.Errorf("fields[%d].type must be one of text, number, textarea, select, switch", idx)
		}

		options := []interactionOption(nil)
		if fieldType == "select" {
			options, err = parseInteractionOptions(fieldMap["options"])
			if err != nil {
				return nil, fmt.Errorf("fields[%d].%s", idx, err.Error())
			}
			if len(options) == 0 {
				return nil, fmt.Errorf("fields[%d].options must include at least one option", idx)
			}
		}

		required, _ := fieldMap["required"].(bool)
		placeholder, _ := fieldMap["placeholder"].(string)
		description, _ := fieldMap["description"].(string)
		defaultValue, _ := fieldMap["default_value"].(string)

		fields = append(fields, interactionField{
			Name:         name,
			Label:        label,
			Type:         fieldType,
			Required:     required,
			Placeholder:  strings.TrimSpace(placeholder),
			Description:  strings.TrimSpace(description),
			DefaultValue: strings.TrimSpace(defaultValue),
			Options:      options,
		})
	}

	return fields, nil
}

func buildInteractionEventData(toolName, toolCallID, sessionID string, request interactionRequest) map[string]interface{} {
	data := map[string]interface{}{
		"tool":         toolName,
		"tool_call_id": toolCallID,
		"session_id":   sessionID,
		"kind":         request.Kind,
		"title":        request.Title,
	}
	if request.Name != "" {
		data["name"] = request.Name
	}
	if request.Description != "" {
		data["description"] = request.Description
	}
	if request.SubmitLabel != "" {
		data["submit_label"] = request.SubmitLabel
	}
	if len(request.Options) > 0 {
		data["options"] = request.Options
	}
	if len(request.Fields) > 0 {
		data["fields"] = request.Fields
	}
	return data
}

func buildInteractionToolResult(request interactionRequest, submitted map[string]interface{}) (string, error) {
	if submitted == nil {
		submitted = map[string]interface{}{}
	}

	switch request.Kind {
	case interactionKindChoice:
		value, exists := submitted[request.Name]
		if !exists {
			return "", fmt.Errorf("%s is required", request.Name)
		}
		selected, err := readStringValue(value)
		if err != nil {
			return "", fmt.Errorf("%s must be a string", request.Name)
		}
		selected = strings.TrimSpace(selected)
		if selected == "" {
			return "", fmt.Errorf("%s is required", request.Name)
		}
		if !interactionOptionExists(request.Options, selected) {
			return "", fmt.Errorf("%s must be one of the provided options", request.Name)
		}
		return marshalInteractionResult(map[string]string{
			request.Name: selected,
		})
	case interactionKindForm:
		result := make(map[string]interface{}, len(request.Fields))
		for _, field := range request.Fields {
			value, exists := submitted[field.Name]
			if !exists {
				if field.Required {
					return "", fmt.Errorf("%s is required", field.Name)
				}
				continue
			}

			normalized, hasValue, err := normalizeInteractionFieldValue(field, value)
			if err != nil {
				return "", fmt.Errorf("%s: %w", field.Name, err)
			}
			if !hasValue {
				if field.Required {
					return "", fmt.Errorf("%s is required", field.Name)
				}
				continue
			}
			result[field.Name] = normalized
		}
		return marshalInteractionResult(result)
	default:
		return "", fmt.Errorf("unsupported interaction kind %s", request.Kind)
	}
}

func normalizeInteractionFieldValue(field interactionField, raw interface{}) (interface{}, bool, error) {
	switch field.Type {
	case "text", "textarea":
		value, err := readStringValue(raw)
		if err != nil {
			return nil, false, fmt.Errorf("must be a string")
		}
		value = strings.TrimSpace(value)
		if value == "" {
			return nil, false, nil
		}
		return value, true, nil
	case "select":
		value, err := readStringValue(raw)
		if err != nil {
			return nil, false, fmt.Errorf("must be a string")
		}
		value = strings.TrimSpace(value)
		if value == "" {
			return nil, false, nil
		}
		if !interactionOptionExists(field.Options, value) {
			return nil, false, fmt.Errorf("must be one of the provided options")
		}
		return value, true, nil
	case "number":
		value, hasValue, err := readNumberValue(raw)
		if err != nil {
			return nil, false, fmt.Errorf("must be a number")
		}
		return value, hasValue, nil
	case "switch":
		value, err := readBoolValue(raw)
		if err != nil {
			return nil, false, fmt.Errorf("must be a boolean")
		}
		return value, true, nil
	default:
		return nil, false, fmt.Errorf("unsupported field type %s", field.Type)
	}
}

func interactionOptionExists(options []interactionOption, value string) bool {
	for _, option := range options {
		if option.Value == value {
			return true
		}
	}
	return false
}

func readStringValue(raw interface{}) (string, error) {
	switch value := raw.(type) {
	case string:
		return value, nil
	default:
		return "", fmt.Errorf("invalid string value")
	}
}

func readNumberValue(raw interface{}) (float64, bool, error) {
	switch value := raw.(type) {
	case nil:
		return 0, false, nil
	case float64:
		return value, true, nil
	case float32:
		return float64(value), true, nil
	case int:
		return float64(value), true, nil
	case int8:
		return float64(value), true, nil
	case int16:
		return float64(value), true, nil
	case int32:
		return float64(value), true, nil
	case int64:
		return float64(value), true, nil
	case uint:
		return float64(value), true, nil
	case uint8:
		return float64(value), true, nil
	case uint16:
		return float64(value), true, nil
	case uint32:
		return float64(value), true, nil
	case uint64:
		return float64(value), true, nil
	case string:
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return 0, false, nil
		}
		number, err := strconv.ParseFloat(trimmed, 64)
		if err != nil {
			return 0, false, err
		}
		return number, true, nil
	default:
		return 0, false, fmt.Errorf("invalid number value")
	}
}

func readBoolValue(raw interface{}) (bool, error) {
	switch value := raw.(type) {
	case bool:
		return value, nil
	case string:
		trimmed := strings.TrimSpace(strings.ToLower(value))
		switch trimmed {
		case "true", "1", "yes", "on":
			return true, nil
		case "false", "0", "no", "off":
			return false, nil
		default:
			return false, fmt.Errorf("invalid boolean value")
		}
	default:
		return false, fmt.Errorf("invalid boolean value")
	}
}

func marshalInteractionResult(value interface{}) (string, error) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}
