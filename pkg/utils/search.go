package utils

import (
	"strings"

	"github.com/zxh326/kite/pkg/common"
)

var searchResourceAliases = common.SearchAliases()

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
