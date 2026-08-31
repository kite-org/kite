package helmutil

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zxh326/kite/pkg/model"
)

func TestLoadRepositoryCatalogFromOCIRepository(t *testing.T) {
	repository := model.HelmRepository{
		Name: "kite",
		URL:  "oci://ghcr.io/kite-org/charts/kite",
	}

	indexFile, err := LoadRepositoryCatalog(repository)
	require.NoError(t, err)

	entries := indexFile.Entries["kite"]
	require.NotEmpty(t, entries)
	require.Equal(t, "kite", entries[0].Name)
	require.NotEmpty(t, entries[0].Version)
	require.NotEmpty(t, entries[0].URLs)
	require.Equal(t, repository.URL+":"+entries[0].Version, entries[0].URLs[0])
}
