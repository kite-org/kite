package resources

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	utilexec "k8s.io/client-go/util/exec"
	metricsv1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

func TestPodExecExitCode(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		wantCode  int
		wantFound bool
	}{
		{
			name:      "wrapped process exit",
			err:       fmt.Errorf("failed to stream execution: %w", utilexec.CodeExitError{Err: errors.New("command failed"), Code: 2}),
			wantCode:  2,
			wantFound: true,
		},
		{
			name: "transport error",
			err:  errors.New("connection refused"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code, found := podExecExitCode(tt.err)
			if code != tt.wantCode || found != tt.wantFound {
				t.Fatalf("podExecExitCode() = (%d, %v), want (%d, %v)", code, found, tt.wantCode, tt.wantFound)
			}
		})
	}
}

func TestParseLsOutput(t *testing.T) {
	output := `
total 8
drwxr-xr-x    1 root     root        4.0K 2025-05-30 12:13:44 +0000 beta
-rw-r--r--    1 root     root          12 2025-05-30 12:13:44 +0000 alpha
drwxr-xr-x    1 root     root        4.0K 2025-05-30 12:13:44 +0000 .
drwxr-xr-x    1 root     root        4.0K 2025-05-30 12:13:44 +0000 ..
ignored line
`

	files := parseLsOutput(output)
	if len(files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(files))
	}

	if files[0].Name != "beta" || !files[0].IsDir {
		t.Fatalf("expected directory first, got %#v", files[0])
	}
	if files[1].Name != "alpha" || files[1].IsDir {
		t.Fatalf("expected file second, got %#v", files[1])
	}
}

func TestValidatePodExecRequest(t *testing.T) {
	timeoutSeconds := func(seconds int) *int {
		return &seconds
	}
	tests := []struct {
		name    string
		request PodExecRequest
		wantErr bool
	}{
		{
			name:    "valid command",
			request: PodExecRequest{Command: []string{"echo", "hello"}, TimeoutSeconds: timeoutSeconds(30)},
		},
		{
			name:    "missing command",
			request: PodExecRequest{TimeoutSeconds: timeoutSeconds(30)},
			wantErr: true,
		},
		{
			name:    "blank executable",
			request: PodExecRequest{Command: []string{" "}, TimeoutSeconds: timeoutSeconds(30)},
			wantErr: true,
		},
		{
			name:    "too many arguments",
			request: PodExecRequest{Command: make([]string, maxPodExecArgs+1), TimeoutSeconds: timeoutSeconds(30)},
			wantErr: true,
		},
		{
			name:    "too long argument",
			request: PodExecRequest{Command: []string{"echo", strings.Repeat("x", maxPodExecArgSize+1)}, TimeoutSeconds: timeoutSeconds(30)},
			wantErr: true,
		},
		{
			name:    "timeout zero",
			request: PodExecRequest{Command: []string{"true"}, TimeoutSeconds: timeoutSeconds(0)},
			wantErr: true,
		},
		{
			name:    "timeout above maximum",
			request: PodExecRequest{Command: []string{"true"}, TimeoutSeconds: timeoutSeconds(int(maxPodExecTimeout/time.Second) + 1)},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validatePodExecRequest(tt.request)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validatePodExecRequest() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestApplyPodExecRequestDefaults(t *testing.T) {
	request := PodExecRequest{Command: []string{"echo", "hello"}}
	applyPodExecRequestDefaults(&request)

	if request.TimeoutSeconds == nil || *request.TimeoutSeconds != defaultPodExecTimeoutSeconds {
		t.Fatalf("timeoutSeconds = %v, want %d", request.TimeoutSeconds, defaultPodExecTimeoutSeconds)
	}
	if err := validatePodExecRequest(request); err != nil {
		t.Fatalf("validatePodExecRequest() with default timeout returned error: %v", err)
	}
}

func TestPodExecOutputWriterCapsCombinedOutput(t *testing.T) {
	limit := &podExecOutputLimit{remaining: 5}
	stdout := &podExecOutputWriter{limit: limit}
	stderr := &podExecOutputWriter{limit: limit}

	if _, err := stdout.Write([]byte("1234")); err != nil {
		t.Fatal(err)
	}
	if _, err := stderr.Write([]byte("5678")); err != nil {
		t.Fatal(err)
	}
	if got := stdout.buffer.String() + stderr.buffer.String(); got != "12345" {
		t.Fatalf("combined output = %q, want %q", got, "12345")
	}
	if !limit.truncated {
		t.Fatal("expected output to be marked truncated")
	}
}

func TestGetPodMetrics(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "demo"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name: "app",
					Resources: corev1.ResourceRequirements{
						Limits: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("500m"),
							corev1.ResourceMemory: resource.MustParse("256Mi"),
						},
						Requests: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("250m"),
							corev1.ResourceMemory: resource.MustParse("128Mi"),
						},
					},
				},
				{
					Name: "sidecar",
					Resources: corev1.ResourceRequirements{
						Limits: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("250m"),
							corev1.ResourceMemory: resource.MustParse("64Mi"),
						},
						Requests: corev1.ResourceList{
							corev1.ResourceCPU: resource.MustParse("100m"),
						},
					},
				},
			},
		},
	}

	metricsMap := map[string]metricsv1.PodMetrics{
		"default/demo": {
			ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
			Containers: []metricsv1.ContainerMetrics{
				{
					Usage: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("300m"),
						corev1.ResourceMemory: resource.MustParse("200Mi"),
					},
				},
				{
					Usage: corev1.ResourceList{
						corev1.ResourceCPU: resource.MustParse("50m"),
					},
				},
			},
		},
	}

	got := GetPodMetrics(metricsMap, pod)
	if got == nil {
		t.Fatalf("expected metrics, got nil")
	}
	if got.CPUUsage != 350 || got.MemoryUsage != 200*1024*1024 {
		t.Fatalf("unexpected usage: %#v", got)
	}
	if got.CPULimit != 750 || got.MemoryLimit != 320*1024*1024 {
		t.Fatalf("unexpected limits: %#v", got)
	}
	if got.CPURequest != 350 || got.MemoryRequest != 128*1024*1024 {
		t.Fatalf("unexpected requests: %#v", got)
	}
}

func TestGetPodMetricsMissingMetrics(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "demo"},
	}

	if got := GetPodMetrics(map[string]metricsv1.PodMetrics{}, pod); got != nil {
		t.Fatalf("expected nil metrics, got %#v", got)
	}
}

func TestParseKubeSemverAndResizeSupport(t *testing.T) {
	tests := []struct {
		name       string
		version    string
		wantValid  bool
		wantResize bool
	}{
		{name: "trimmed prefix", version: " v1.35.0 ", wantValid: true, wantResize: true},
		{name: "below threshold", version: "v1.34.9", wantValid: true, wantResize: false},
		{name: "at threshold", version: "1.35.0", wantValid: true, wantResize: true},
		{name: "invalid", version: "not-a-version", wantValid: false, wantResize: false},
		{name: "empty", version: " ", wantValid: false, wantResize: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			parsed, err := parseKubeSemver(tt.version)
			if (err == nil) != tt.wantValid {
				t.Fatalf("parseKubeSemver(%q) error = %v, wantValid %v", tt.version, err, tt.wantValid)
			}
			if got := isPodResizeSupported(tt.version); got != tt.wantResize {
				t.Fatalf("isPodResizeSupported(%q) = %v, want %v", tt.version, got, tt.wantResize)
			}
			if tt.wantValid && parsed.Major == 0 && parsed.Minor == 0 && parsed.Patch == 0 {
				t.Fatalf("expected parsed version for %q", tt.version)
			}
		})
	}
}
