package cluster

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/zxh326/kite/pkg/model"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
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
