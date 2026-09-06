package cluster

import (
	"testing"

	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/statefultoken"
)

func TestNewKubeconfigTokenServiceUsesDedicatedConfiguration(t *testing.T) {
	previousSecret, previousKID := common.KubeconfigJWTSecret, common.KubeconfigJWTKID
	common.KubeconfigJWTSecret, common.KubeconfigJWTKID = "test-kubeconfig-secret", "test-kid"
	t.Cleanup(func() { common.KubeconfigJWTSecret, common.KubeconfigJWTKID = previousSecret, previousKID })

	if _, err := newKubeconfigTokenService(); err != nil {
		t.Fatal(err)
	}
}

func TestKubeconfigTokenHashDoesNotContainJTI(t *testing.T) {
	jti := "sensitive-jti"
	hash := statefultoken.HashJTI(jti)
	if hash == jti || len(hash) != 64 {
		t.Fatalf("unexpected jti hash %q", hash)
	}
}
