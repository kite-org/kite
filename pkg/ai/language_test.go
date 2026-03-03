package ai

import "testing"

func TestNormalizeLanguage(t *testing.T) {
	testCases := []struct {
		name     string
		input    string
		expected string
	}{
		{name: "empty", input: "", expected: ""},
		{name: "english", input: "en", expected: "en"},
		{name: "english locale", input: "en-US", expected: "en"},
		{name: "chinese", input: "zh", expected: "zh"},
		{name: "chinese underscore", input: "zh_CN", expected: "zh"},
		{name: "unsupported", input: "fr-FR", expected: ""},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			actual := normalizeLanguage(tc.input)
			if actual != tc.expected {
				t.Fatalf("expected %q, got %q", tc.expected, actual)
			}
		})
	}
}

func TestDetectRequestLanguage(t *testing.T) {
	testCases := []struct {
		name           string
		requestLang    string
		acceptLanguage string
		expected       string
	}{
		{
			name:           "request language has priority",
			requestLang:    "zh-CN",
			acceptLanguage: "en-US,en;q=0.9",
			expected:       "zh",
		},
		{
			name:           "accept language fallback",
			requestLang:    "",
			acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
			expected:       "zh",
		},
		{
			name:           "accept language english",
			requestLang:    "",
			acceptLanguage: "en-US,en;q=0.9",
			expected:       "en",
		},
		{
			name:           "unsupported request uses header",
			requestLang:    "fr",
			acceptLanguage: "zh-CN,zh;q=0.9",
			expected:       "zh",
		},
		{
			name:           "default english",
			requestLang:    "",
			acceptLanguage: "",
			expected:       "en",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			actual := detectRequestLanguage(tc.requestLang, tc.acceptLanguage)
			if actual != tc.expected {
				t.Fatalf("expected %q, got %q", tc.expected, actual)
			}
		})
	}
}
