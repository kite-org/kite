package cluster

import (
	"errors"
	"os"

	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/statefultoken"
)

const kubeconfigJWTIssuer = "kite-kubeconfig"

func newKubeconfigTokenService() (*statefultoken.Service, error) {
	secret := common.KubeconfigJWTSecret
	if secret == "" || (secret == common.DefaultJWTSecret && os.Getenv("KUBECONFIG_JWT_SECRET") == "" && os.Getenv("KITE_ENV") == "production") {
		return nil, errors.New("KUBECONFIG_JWT_SECRET is required")
	}
	return statefultoken.New(statefultoken.Config{
		Issuer: kubeconfigJWTIssuer, Purpose: "kubeconfig", Secret: []byte(secret), KeyID: common.KubeconfigJWTKID,
	}, kubeconfigTokenStore{})
}
