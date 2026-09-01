package ai

import (
	"reflect"
	"testing"
)

func TestRedactHelmValues(t *testing.T) {
	values := map[string]interface{}{
		"replicaCount": 2,
		"image":        map[string]interface{}{"tag": "1.2.3"},
		"auth": map[string]interface{}{
			"postgresPassword": "hunter2",
			"username":         "admin",
		},
		"credentials": map[string]interface{}{
			"user": "svc",
			"pass": "hunter2",
		},
		"api_key": "abc123",
		"tokens":  []interface{}{"t1", "t2"},
		"smtp":    map[string]interface{}{"pass": "hunter2"},
		"ingress": map[string]interface{}{
			"tls": []interface{}{map[string]interface{}{"secretName": "tls-cert"}},
		},
		"existingSecret":   "db-secret",
		"imagePullSecrets": []interface{}{map[string]interface{}{"name": "regcred"}},
	}

	got := redactHelmValues(values)
	want := map[string]interface{}{
		"replicaCount": 2,
		"image":        map[string]interface{}{"tag": "1.2.3"},
		"auth": map[string]interface{}{
			"postgresPassword": "***",
			"username":         "admin",
		},
		"credentials": map[string]interface{}{
			"user": "***",
			"pass": "***",
		},
		"api_key": "***",
		"tokens":  []interface{}{"***", "***"},
		"smtp":    map[string]interface{}{"pass": "***"},
		"ingress": map[string]interface{}{
			"tls": []interface{}{map[string]interface{}{"secretName": "tls-cert"}},
		},
		"existingSecret":   "db-secret",
		"imagePullSecrets": []interface{}{map[string]interface{}{"name": "regcred"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected redaction:\nwant: %#v\ngot:  %#v", want, got)
	}

	if values["api_key"] != "abc123" {
		t.Fatalf("redactHelmValues must not mutate the input values")
	}
}

func TestContainsRedactedHelmValue(t *testing.T) {
	if !containsRedactedHelmValue(map[string]interface{}{"auth": map[string]interface{}{"password": "***"}}) {
		t.Fatalf("expected nested placeholder to be detected")
	}
	if !containsRedactedHelmValue(map[string]interface{}{"tokens": []interface{}{"***"}}) {
		t.Fatalf("expected placeholder in list to be detected")
	}
	if containsRedactedHelmValue(map[string]interface{}{"auth": map[string]interface{}{"password": "hunter2"}}) {
		t.Fatalf("expected real values to pass")
	}
}

func TestHelmRevisionFromArgs(t *testing.T) {
	tests := []struct {
		name    string
		args    map[string]interface{}
		want    int
		wantErr bool
	}{
		{name: "absent defaults to zero", args: map[string]interface{}{}, want: 0},
		{name: "nil defaults to zero", args: map[string]interface{}{"revision": nil}, want: 0},
		{name: "integer number", args: map[string]interface{}{"revision": float64(3)}, want: 3},
		{name: "string is rejected", args: map[string]interface{}{"revision": "3"}, wantErr: true},
		{name: "fractional is rejected", args: map[string]interface{}{"revision": 3.7}, wantErr: true},
		{name: "zero is rejected", args: map[string]interface{}{"revision": float64(0)}, wantErr: true},
		{name: "negative is rejected", args: map[string]interface{}{"revision": float64(-1)}, wantErr: true},
		{name: "overflowing number is rejected", args: map[string]interface{}{"revision": 1e308}, wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := helmRevisionFromArgs(tc.args)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got revision %d", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("unexpected revision: want %d, got %d", tc.want, got)
			}
		})
	}
}
