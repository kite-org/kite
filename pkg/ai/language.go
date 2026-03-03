package ai

import "strings"

func normalizeLanguage(value string) string {
	language := strings.TrimSpace(strings.ToLower(value))
	if language == "" {
		return ""
	}
	language = strings.ReplaceAll(language, "_", "-")
	switch {
	case strings.HasPrefix(language, "zh"):
		return "zh"
	case strings.HasPrefix(language, "en"):
		return "en"
	default:
		return ""
	}
}

func detectRequestLanguage(requestLanguage, acceptLanguage string) string {
	if language := normalizeLanguage(requestLanguage); language != "" {
		return language
	}

	parts := strings.Split(acceptLanguage, ",")
	for _, part := range parts {
		candidate := strings.TrimSpace(part)
		if candidate == "" {
			continue
		}
		if idx := strings.Index(candidate, ";"); idx >= 0 {
			candidate = strings.TrimSpace(candidate[:idx])
		}
		if language := normalizeLanguage(candidate); language != "" {
			return language
		}
	}

	return "en"
}
