package ai

func buildToolCallEventData(tc streamedToolCall, args map[string]interface{}) map[string]interface{} {
	return map[string]interface{}{
		"tool":         tc.Name,
		"tool_call_id": tc.ID,
		"args":         args,
	}
}

func buildToolResultEventData(toolCallID, toolName, result string, isError bool) map[string]interface{} {
	return map[string]interface{}{
		"tool":         toolName,
		"tool_call_id": toolCallID,
		"result":       result,
		"is_error":     isError,
	}
}

func buildActionRequiredEventData(tc streamedToolCall, sessionID string, args map[string]interface{}) map[string]interface{} {
	return map[string]interface{}{
		"tool":         tc.Name,
		"tool_call_id": tc.ID,
		"args":         args,
		"session_id":   sessionID,
	}
}
