package resources

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/helmutil"
	"github.com/zxh326/kite/pkg/model"
	releasecommon "helm.sh/helm/v4/pkg/release/common"
	release "helm.sh/helm/v4/pkg/release/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

func TestHelmReleaseRBACAllNamespaces(t *testing.T) {
	secrets := corev1.SecretList{
		TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "SecretList"},
		Items: []corev1.Secret{
			helmReleaseSecret(t, "allowed", "default"),
			helmReleaseSecret(t, "denied", "team-a"),
		},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/version":
			_, _ = w.Write([]byte(`{"major":"1","minor":"35","gitVersion":"v1.35.0"}`))
		case "/api/v1/secrets":
			_ = json.NewEncoder(w).Encode(secrets)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	fixture := newPodAPITestFixture(t, podAPITestConfig{
		user: model.User{
			Username: "alice",
			Roles: []common.Role{
				{
					Name:       "helm-default-reader",
					Clusters:   []string{"cluster-a"},
					Namespaces: []string{"default"},
					Resources:  []string{string(common.HelmReleases)},
					Verbs:      []string{string(common.VerbGet)},
				},
				{
					Name:       "configmap-team-reader",
					Clusters:   []string{"cluster-a"},
					Namespaces: []string{"team-a"},
					Resources:  []string{string(common.ConfigMaps)},
					Verbs:      []string{string(common.VerbGet)},
				},
			},
		},
		clusterAConfig: &rest.Config{Host: server.URL},
	})

	for _, path := range []string{
		"/api/v1/helmrelease",
		"/api/v1/helmrelease/_all",
		"/api/v1/_clusters/cluster-a/helmrelease",
		"/api/v1/_clusters/cluster-a/helmrelease/_all",
	} {
		t.Run(path, func(t *testing.T) {
			response := performPodAPIRequest(t, fixture, http.MethodGet, path, "", nil)
			if response.Code != http.StatusOK {
				t.Fatalf("GET %s returned %d, want %d; body=%s", path, response.Code, http.StatusOK, response.Body.String())
			}
			list := decodePodAPIResponse[helmutil.HelmReleaseList](t, response)
			if len(list.Items) != 1 || list.Items[0].Namespace != "default" || list.Items[0].Name != "allowed" {
				t.Fatalf("GET %s returned %#v, want only default/allowed", path, list.Items)
			}
		})
	}
}

func TestHelmReleaseListOmitsValuesAndManifest(t *testing.T) {
	secrets := corev1.SecretList{
		TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "SecretList"},
		Items: []corev1.Secret{
			helmReleaseSecretWithPayload(t, "app", "default", map[string]interface{}{"dbPassword": "secret"}, "apiVersion: v1\nkind: Secret\n"),
		},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/version":
			_, _ = w.Write([]byte(`{"major":"1","minor":"35","gitVersion":"v1.35.0"}`))
		case "/api/v1/secrets", "/api/v1/namespaces/default/secrets":
			_ = json.NewEncoder(w).Encode(secrets)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	fixture := newPodAPITestFixture(t, podAPITestConfig{
		user: model.User{
			Username: "alice",
			Roles: []common.Role{
				{
					Name:       "helm-reader",
					Clusters:   []string{"cluster-a"},
					Namespaces: []string{"default"},
					Resources:  []string{string(common.HelmReleases)},
					Verbs:      []string{string(common.VerbGet)},
				},
			},
		},
		clusterAConfig: &rest.Config{Host: server.URL},
	})

	listResp := performPodAPIRequest(t, fixture, http.MethodGet, "/api/v1/helmrelease", "", nil)
	if listResp.Code != http.StatusOK {
		t.Fatalf("GET /api/v1/helmrelease returned %d, want 200; body=%s", listResp.Code, listResp.Body.String())
	}
	list := decodePodAPIResponse[helmutil.HelmReleaseList](t, listResp)
	if len(list.Items) != 1 {
		t.Fatalf("expected 1 release, got %d", len(list.Items))
	}
	if list.Items[0].Spec.Values != nil || list.Items[0].Spec.Manifest != "" {
		t.Fatalf("list response leaked payload: values=%#v manifest=%q", list.Items[0].Spec.Values, list.Items[0].Spec.Manifest)
	}

	getResp := performPodAPIRequest(t, fixture, http.MethodGet, "/api/v1/helmrelease/default/app", "", nil)
	if getResp.Code != http.StatusOK {
		t.Fatalf("GET /api/v1/helmrelease/default/app returned %d, want 200; body=%s", getResp.Code, getResp.Body.String())
	}
	detail := decodePodAPIResponse[helmutil.HelmRelease](t, getResp)
	if detail.Spec.Values["dbPassword"] != "secret" || detail.Spec.Manifest == "" {
		t.Fatalf("detail response missing expected payload: values=%#v manifest=%q", detail.Spec.Values, detail.Spec.Manifest)
	}
}

func helmReleaseSecret(t *testing.T, name, namespace string) corev1.Secret {
	return helmReleaseSecretWithPayload(t, name, namespace, nil, "")
}

func helmReleaseSecretWithPayload(t *testing.T, name, namespace string, config map[string]interface{}, manifest string) corev1.Secret {
	t.Helper()
	releaseData, err := json.Marshal(&release.Release{
		Name:      name,
		Namespace: namespace,
		Version:   1,
		Config:    config,
		Manifest:  manifest,
		Info:      &release.Info{Status: releasecommon.StatusDeployed},
	})
	if err != nil {
		t.Fatal(err)
	}
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write(releaseData); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	encoded := base64.StdEncoding.EncodeToString(compressed.Bytes())
	return corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "sh.helm.release.v1." + name + ".v1",
			Namespace: namespace,
			Labels: map[string]string{
				"name":    name,
				"owner":   "helm",
				"status":  "deployed",
				"version": "1",
			},
		},
		Type: "helm.sh/release.v1",
		Data: map[string][]byte{"release": []byte(encoded)},
	}
}
