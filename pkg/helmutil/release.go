package helmutil

import (
	"fmt"

	helmrelease "helm.sh/helm/v4/pkg/release"
	release "helm.sh/helm/v4/pkg/release/v1"
)

func ReleaseFromReleaser(releaser helmrelease.Releaser) (*release.Release, error) {
	rel, ok := releaser.(*release.Release)
	if !ok {
		return nil, fmt.Errorf("unsupported helm release type %T", releaser)
	}
	return rel, nil
}

func ReleasesFromReleasers(releasers []helmrelease.Releaser) ([]*release.Release, error) {
	releases := make([]*release.Release, 0, len(releasers))
	for _, releaser := range releasers {
		rel, err := ReleaseFromReleaser(releaser)
		if err != nil {
			return nil, err
		}
		releases = append(releases, rel)
	}
	return releases, nil
}

func ChartInfo(rel *release.Release) (string, string, string) {
	if rel.Chart == nil || rel.Chart.Metadata == nil {
		return "", "", ""
	}
	return rel.Chart.Metadata.Name, rel.Chart.Metadata.Version, rel.Chart.Metadata.AppVersion
}
