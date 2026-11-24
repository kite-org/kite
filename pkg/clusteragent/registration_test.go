package clusteragent

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestAuthorizationRoundTripperImpersonationHeaders(t *testing.T) {
	manager := &Manager{registrations: map[string]registeredCluster{"1": {}}}
	var captured http.Header
	rt := &authorizationRoundTripper{
		next: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			captured = req.Header.Clone()
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       http.NoBody,
				Header:     make(http.Header),
				Request:    req,
			}, nil
		}),
		manager:   manager,
		clientKey: "1",
	}

	req := httptest.NewRequest(http.MethodGet, "https://apiserver.example.com/api/v1/pods", nil)
	req.Header.Set("Impersonate-User", "alice@example.com")
	req.Header.Add("Impersonate-Group", "dev")

	resp, err := rt.RoundTrip(req)
	if err != nil {
		t.Fatalf("RoundTrip() error = %v", err)
	}
	_ = resp.Body.Close()
	if got := captured.Get("Impersonate-User"); got != "" {
		t.Fatalf("client-supplied Impersonate-User = %q, want empty", got)
	}

	trusted := req.WithContext(WithTrustedImpersonation(req.Context()))
	resp, err = rt.RoundTrip(trusted)
	if err != nil {
		t.Fatalf("RoundTrip() error = %v", err)
	}
	_ = resp.Body.Close()
	if got := captured.Get("Impersonate-User"); got != "alice@example.com" {
		t.Fatalf("trusted Impersonate-User = %q, want %q", got, "alice@example.com")
	}
	if got := captured.Values("Impersonate-Group"); len(got) != 1 || got[0] != "dev" {
		t.Fatalf("trusted Impersonate-Group = %q, want [dev]", got)
	}
}
