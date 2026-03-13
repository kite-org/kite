package ai

import (
	"context"
	"fmt"
	"strings"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/gin-gonic/gin"
	"github.com/openai/openai-go"
)

const titlePrompt = `Generate a concise title for this chat conversation.
Rules:
- Return only the title text, with no quotes or markdown.
- Keep it under 8 words.
- Prefer the user's language.
- Focus on the concrete task or problem.
- Avoid generic titles like "New Chat" or "Kubernetes Help" unless absolutely necessary.`

const maxTitleMessages = 6

func buildTitleMessages(chatMessages []ChatMessage) []ChatMessage {
	normalized := normalizeChatMessages(chatMessages)
	if len(normalized) > maxTitleMessages {
		normalized = normalized[:maxTitleMessages]
	}
	return normalized
}

func cleanGeneratedTitle(title string) string {
	title = strings.TrimSpace(title)
	title = strings.Trim(title, "\"'` ")
	title = strings.ReplaceAll(title, "\n", " ")
	title = strings.Join(strings.Fields(title), " ")
	if title == "" {
		return "New Chat"
	}
	runes := []rune(title)
	if len(runes) > 60 {
		title = string(runes[:60])
	}
	return title
}

func (a *Agent) GenerateTitle(c *gin.Context, req *TitleRequest) (string, error) {
	ctx := c.Request.Context()
	messages := buildTitleMessages(req.Messages)
	if len(messages) == 0 {
		return "New Chat", nil
	}
	lang := normalizeLanguage(req.Language)
	if lang == "" {
		lang = "en"
	}

	switch a.provider {
	case "anthropic":
		return a.generateTitleAnthropic(ctx, lang, messages)
	default:
		return a.generateTitleOpenAI(ctx, lang, messages)
	}
}

func (a *Agent) generateTitleOpenAI(ctx context.Context, language string, chatMessages []ChatMessage) (string, error) {
	system := titlePrompt + fmt.Sprintf("\nRespond in language: %s.", language)
	resp, err := a.openaiClient.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model:               a.model,
		Messages:            toOpenAIMessages(system, chatMessages),
		MaxCompletionTokens: openai.Int(32),
	})
	if err != nil {
		return "", err
	}
	if len(resp.Choices) == 0 {
		return "New Chat", nil
	}
	return cleanGeneratedTitle(resp.Choices[0].Message.Content), nil
}

func (a *Agent) generateTitleAnthropic(ctx context.Context, language string, chatMessages []ChatMessage) (string, error) {
	resp, err := a.anthropicClient.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     anthropic.Model(a.model),
		Messages:  toAnthropicMessages(chatMessages),
		System:    []anthropic.TextBlockParam{{Text: titlePrompt + fmt.Sprintf("\nRespond in language: %s.", language)}},
		MaxTokens: 32,
	})
	if err != nil {
		return "", err
	}
	var builder strings.Builder
	for _, block := range resp.Content {
		if block.Type == "text" {
			builder.WriteString(block.Text)
		}
	}
	return cleanGeneratedTitle(builder.String()), nil
}
