package cluster

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/zxh326/kite/pkg/model"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

func TestClientForImpersonatesUser(t *testing.T) {
	var mu sync.Mutex
	var users, groups, authorizations []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		users = append(users, r.Header.Get("Impersonate-User"))
		groups = append(groups, r.Header.Get("Impersonate-Group"))
		authorizations = append(authorizations, r.Header.Get("Authorization"))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"PodList","apiVersion":"v1","items":[]}`))
	}))
	defer server.Close()

	base := &rest.Config{Host: server.URL, BearerToken: "kite-token"}
	cs := &ClientSet{Name: "test", restConfig: base, impersonate: true}

	for _, user := range []model.User{
		{Username: "alice@example.com", OIDCGroups: model.SliceString{"dev", "ops"}},
		{Username: "bob@example.com", OIDCGroups: model.SliceString{"viewers"}},
	} {
		userCS, err := cs.ClientFor(user)
		if err != nil {
			t.Fatalf("ClientFor() error = %v", err)
		}
		if userCS == cs {
			t.Fatal("ClientFor() returned the shared client set for an impersonating cluster")
		}
		if _, err := userCS.K8sClient.ClientSet.CoreV1().Pods("default").List(context.Background(), metav1.ListOptions{}); err != nil {
			t.Fatalf("List() error = %v", err)
		}
	}

	mu.Lock()
	defer mu.Unlock()
	if len(users) != 2 {
		t.Fatalf("request count = %d, want 2", len(users))
	}
	if users[0] != "alice@example.com" || users[1] != "bob@example.com" {
		t.Fatalf("Impersonate-User = %q, %q", users[0], users[1])
	}
	if groups[0] != "dev" || groups[1] != "viewers" {
		t.Fatalf("Impersonate-Group = %q, %q", groups[0], groups[1])
	}
	for i, auth := range authorizations {
		if auth != "Bearer kite-token" {
			t.Fatalf("request %d Authorization = %q, want the cluster credential", i, auth)
		}
	}
	if base.Impersonate.UserName != "" || base.BearerToken != "kite-token" {
		t.Fatalf("shared config mutated: %#v", base)
	}
}

func TestClientForUsesExecProviderAndRetainsStreamingConfig(t *testing.T) {
	var mu sync.Mutex
	var users, authorizations []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		users = append(users, r.Header.Get("Impersonate-User"))
		authorizations = append(authorizations, r.Header.Get("Authorization"))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"PodList","apiVersion":"v1","items":[]}`))
	}))
	defer server.Close()

	dial := (&net.Dialer{}).DialContext
	base := &rest.Config{
		Host: server.URL,
		ExecProvider: &clientcmdapi.ExecConfig{
			APIVersion:      "client.authentication.k8s.io/v1beta1",
			Command:         "sh",
			InteractiveMode: clientcmdapi.NeverExecInteractiveMode,
			Args:            []string{"-c", `echo '{"apiVersion":"client.authentication.k8s.io/v1beta1","kind":"ExecCredential","status":{"token":"exec-token"}}'`},
		},
		TLSClientConfig: rest.TLSClientConfig{Insecure: true, ServerName: "kite.test"},
		Dial:            dial,
		WrapTransport:   func(next http.RoundTripper) http.RoundTripper { return next },
	}
	cs := &ClientSet{Name: "test", restConfig: base, impersonate: true}

	userCS, err := cs.ClientFor(model.User{Username: "alice@example.com"})
	if err != nil {
		t.Fatalf("ClientFor() error = %v", err)
	}
	if _, err := userCS.K8sClient.ClientSet.CoreV1().Pods("default").List(context.Background(), metav1.ListOptions{}); err != nil {
		t.Fatalf("List() error = %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(users) != 1 || users[0] != "alice@example.com" {
		t.Fatalf("Impersonate-User = %v, want [alice@example.com]", users)
	}
	if len(authorizations) != 1 || authorizations[0] != "Bearer exec-token" {
		t.Fatalf("Authorization = %v, want [Bearer exec-token]", authorizations)
	}

	streaming := userCS.K8sClient.Configuration
	if streaming.Transport != nil {
		t.Fatal("streaming configuration uses the shared transport")
	}
	if !streaming.Insecure || streaming.ServerName != "kite.test" {
		t.Fatalf("streaming configuration lost TLS settings: %#v", streaming.TLSClientConfig)
	}
	if streaming.Dial == nil {
		t.Fatal("streaming configuration lost the cluster dialer")
	}
	if streaming.ExecProvider == nil {
		t.Fatal("streaming configuration lost the exec provider")
	}
	if streaming.Impersonate.UserName != "alice@example.com" {
		t.Fatalf("streaming impersonation user = %q, want alice@example.com", streaming.Impersonate.UserName)
	}
}

func TestClientForWithoutImpersonationReturnsSharedClientSet(t *testing.T) {
	cs := &ClientSet{Name: "test", impersonate: false}
	got, err := cs.ClientFor(model.User{Username: "alice@example.com"})
	if err != nil {
		t.Fatalf("ClientFor() error = %v", err)
	}
	if got != cs {
		t.Fatal("ClientFor() did not return the shared client set")
	}
	if cs.ImpersonationEnabled() {
		t.Fatal("ImpersonationEnabled() = true, want false")
	}
}

func TestClientForRejectsUserWithoutIdentity(t *testing.T) {
	cs := &ClientSet{Name: "test", restConfig: &rest.Config{Host: "https://example.com"}, impersonate: true}
	if _, err := cs.ClientFor(model.User{}); err == nil {
		t.Fatal("ClientFor() with an unidentified user succeeded")
	}
}
