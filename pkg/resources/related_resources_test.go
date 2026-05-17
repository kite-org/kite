package resources

import (
	"context"
	"reflect"
	"testing"

	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
	gatewayapiv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func TestDiscoverIngressServices(t *testing.T) {
	ingress := &networkingv1.Ingress{
		Spec: networkingv1.IngressSpec{
			Rules: []networkingv1.IngressRule{
				{
					IngressRuleValue: networkingv1.IngressRuleValue{
						HTTP: &networkingv1.HTTPIngressRuleValue{
							Paths: []networkingv1.HTTPIngressPath{
								{Backend: networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{Name: "svc-a"}}},
								{Backend: networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{Name: "svc-b"}}},
								{Backend: networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{Name: "svc-a"}}},
							},
						},
					},
				},
				{},
			},
			DefaultBackend: &networkingv1.IngressBackend{
				Service: &networkingv1.IngressServiceBackend{Name: "svc-b"},
			},
		},
	}

	got := discoverIngressServices("default", ingress)
	want := []common.RelatedResource{
		{Type: "services", Namespace: "default", Name: "svc-a"},
		{Type: "services", Namespace: "default", Name: "svc-b"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("discoverIngressServices() = %#v, want %#v", got, want)
	}
}

func TestDiscoverConfigs(t *testing.T) {
	podSpec := &corev1.PodTemplateSpec{
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name: "app",
					Env: []corev1.EnvVar{
						{ValueFrom: &corev1.EnvVarSource{ConfigMapKeyRef: &corev1.ConfigMapKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: "cm-env"}, Key: "key"}}},
						{ValueFrom: &corev1.EnvVarSource{SecretKeyRef: &corev1.SecretKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: "sec-env"}, Key: "key"}}},
					},
					EnvFrom: []corev1.EnvFromSource{
						{ConfigMapRef: &corev1.ConfigMapEnvSource{LocalObjectReference: corev1.LocalObjectReference{Name: "cm-from"}}},
						{SecretRef: &corev1.SecretEnvSource{LocalObjectReference: corev1.LocalObjectReference{Name: "sec-from"}}},
					},
				},
			},
			Volumes: []corev1.Volume{
				{VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: "cm-vol"}}}},
				{VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: "sec-vol"}}},
				{VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: "pvc-vol"}}},
			},
		},
	}

	got := discoverConfigs("default", podSpec)
	want := []common.RelatedResource{
		{Type: "configmaps", Namespace: "default", Name: "cm-env"},
		{Type: "configmaps", Namespace: "default", Name: "cm-from"},
		{Type: "configmaps", Namespace: "default", Name: "cm-vol"},
		{Type: "secrets", Namespace: "default", Name: "sec-env"},
		{Type: "secrets", Namespace: "default", Name: "sec-from"},
		{Type: "secrets", Namespace: "default", Name: "sec-vol"},
		{Type: "persistentvolumeclaims", Namespace: "default", Name: "pvc-vol"},
	}
	if !sameRelatedResources(got, want) {
		t.Fatalf("discoverConfigs() = %#v, want %#v", got, want)
	}
}

func TestCheckInUsedConfigs(t *testing.T) {
	podSpec := &corev1.PodTemplateSpec{
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{
				{
					Name: "init",
					Env: []corev1.EnvVar{
						{ValueFrom: &corev1.EnvVarSource{ConfigMapKeyRef: &corev1.ConfigMapKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: "cm-init"}, Key: "key"}}},
					},
				},
			},
			Containers: []corev1.Container{
				{
					Name: "app",
					Env: []corev1.EnvVar{
						{ValueFrom: &corev1.EnvVarSource{SecretKeyRef: &corev1.SecretKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: "sec-env"}, Key: "key"}}},
					},
					EnvFrom: []corev1.EnvFromSource{
						{ConfigMapRef: &corev1.ConfigMapEnvSource{LocalObjectReference: corev1.LocalObjectReference{Name: "cm-from"}}},
					},
				},
			},
			Volumes: []corev1.Volume{
				{VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: "pvc-vol"}}},
			},
		},
	}

	tests := []struct {
		name         string
		resourceType string
		resourceName string
		want         bool
	}{
		{name: "configmap from init env", resourceType: "configmaps", resourceName: "cm-init", want: true},
		{name: "configmap from envFrom", resourceType: "configmaps", resourceName: "cm-from", want: true},
		{name: "secret from env", resourceType: "secrets", resourceName: "sec-env", want: true},
		{name: "pvc from volume", resourceType: "persistentvolumeclaims", resourceName: "pvc-vol", want: true},
		{name: "missing configmap", resourceType: "configmaps", resourceName: "missing", want: false},
		{name: "nil spec", resourceType: "secrets", resourceName: "sec-env", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spec := podSpec
			if tt.name == "nil spec" {
				spec = nil
			}
			if got := checkInUsedConfigs(spec, tt.resourceName, tt.resourceType); got != tt.want {
				t.Fatalf("checkInUsedConfigs() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGetHTTPRouteRelatedResources(t *testing.T) {
	parentKind := gatewayapiv1.Kind("Gateway")
	backendKind := gatewayapiv1.Kind("ConfigMap")
	parentNamespace := gatewayapiv1.Namespace("edge")
	backendNamespace := gatewayapiv1.Namespace("apps")

	route := &gatewayapiv1.HTTPRoute{
		Spec: gatewayapiv1.HTTPRouteSpec{
			CommonRouteSpec: gatewayapiv1.CommonRouteSpec{
				ParentRefs: []gatewayapiv1.ParentReference{
					{Name: gatewayapiv1.ObjectName("gw-a")},
					{Name: gatewayapiv1.ObjectName("gw-b"), Kind: &parentKind, Namespace: &parentNamespace},
				},
			},
			Rules: []gatewayapiv1.HTTPRouteRule{
				{
					BackendRefs: []gatewayapiv1.HTTPBackendRef{
						{
							BackendRef: gatewayapiv1.BackendRef{
								BackendObjectReference: gatewayapiv1.BackendObjectReference{
									Name: gatewayapiv1.ObjectName("svc-a"),
								},
							},
						},
						{
							BackendRef: gatewayapiv1.BackendRef{
								BackendObjectReference: gatewayapiv1.BackendObjectReference{
									Name:      gatewayapiv1.ObjectName("cfg"),
									Kind:      &backendKind,
									Namespace: &backendNamespace,
								},
							},
						},
					},
				},
			},
		},
	}

	got := getHTTPRouteRelatedResouces(route, "default")
	want := []common.RelatedResource{
		{Type: "gateways", Name: "gw-a", Namespace: "default", APIVersion: gatewayapiv1.GroupVersion.String()},
		{Type: "gateways", Name: "gw-b", Namespace: "edge", APIVersion: gatewayapiv1.GroupVersion.String()},
		{Type: "services", Name: "svc-a", Namespace: "default", APIVersion: corev1.SchemeGroupVersion.String()},
		{Type: "configmaps", Name: "cfg", Namespace: "apps"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("getHTTPRouteRelatedResouces() = %#v, want %#v", got, want)
	}
}

func TestGetAutoScalingRelatedResources(t *testing.T) {
	hpa := &autoscalingv2.HorizontalPodAutoscaler{
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{
				Kind:       "Deployment",
				APIVersion: "apps/v1",
				Name:       "demo",
			},
		},
	}

	got := getAutoScalingRelatedResources(hpa, "default")
	want := []common.RelatedResource{
		{Type: "deployments", APIVersion: "apps/v1", Name: "demo", Namespace: "default"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("getAutoScalingRelatedResources() = %#v, want %#v", got, want)
	}
}

func TestDiscoverPodsByPodDisruptionBudget(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = corev1.AddToScheme(scheme)
	fakeClient := fake.NewClientBuilder().WithScheme(scheme).WithObjects(
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod-1", Namespace: "default", Labels: map[string]string{"app": "nginx"}}},
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod-2", Namespace: "default", Labels: map[string]string{"app": "nginx"}}},
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod-other", Namespace: "default", Labels: map[string]string{"app": "busybox"}}},
	).Build()

	k8sClient := &kube.K8sClient{Client: fakeClient}
	selector := &metav1.LabelSelector{MatchLabels: map[string]string{"app": "nginx"}}
	got, err := discoverPodsByPodDisruptionBudget(context.Background(), k8sClient, "default", selector)
	if err != nil {
		t.Fatalf("discoverPodsByPodDisruptionBudget() error = %v", err)
	}
	want := []common.RelatedResource{
		{Type: "pods", Namespace: "default", Name: "pod-1"},
		{Type: "pods", Namespace: "default", Name: "pod-2"},
	}
	if !sameRelatedResources(got, want) {
		t.Fatalf("discoverPodsByPodDisruptionBudget() = %#v, want %#v", got, want)
	}
}

func TestDiscoverPodDisruptionBudgetsByPod(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = corev1.AddToScheme(scheme)
	_ = policyv1.AddToScheme(scheme)
	fakeClient := fake.NewClientBuilder().WithScheme(scheme).WithObjects(
		&policyv1.PodDisruptionBudget{
			ObjectMeta: metav1.ObjectMeta{Name: "pdb-1", Namespace: "default"},
			Spec: policyv1.PodDisruptionBudgetSpec{
				Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "nginx"}},
			},
		},
		&policyv1.PodDisruptionBudget{
			ObjectMeta: metav1.ObjectMeta{Name: "pdb-other", Namespace: "default"},
			Spec: policyv1.PodDisruptionBudgetSpec{
				Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "busybox"}},
			},
		},
	).Build()

	k8sClient := &kube.K8sClient{Client: fakeClient}
	podLabels := map[string]string{"app": "nginx"}
	got, err := discoverPodDisruptionBudgetsByPod(context.Background(), k8sClient, "default", podLabels)
	if err != nil {
		t.Fatalf("discoverPodDisruptionBudgetsByPod() error = %v", err)
	}
	want := []common.RelatedResource{
		{Type: "poddisruptionbudgets", Namespace: "default", Name: "pdb-1"},
	}
	if !sameRelatedResources(got, want) {
		t.Fatalf("discoverPodDisruptionBudgetsByPod() = %#v, want %#v", got, want)
	}
}

func sameRelatedResources(got []common.RelatedResource, want []common.RelatedResource) bool {
	if len(got) != len(want) {
		return false
	}
	gotMap := make(map[string]int, len(got))
	wantMap := make(map[string]int, len(want))
	for _, item := range got {
		gotMap[relatedResourceKey(item)]++
	}
	for _, item := range want {
		wantMap[relatedResourceKey(item)]++
	}
	return reflect.DeepEqual(gotMap, wantMap)
}

func relatedResourceKey(item common.RelatedResource) string {
	return item.Type + "|" + item.APIVersion + "|" + item.Name + "|" + item.Namespace
}
