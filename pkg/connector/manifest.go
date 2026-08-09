package connector

import (
	"fmt"
	"strings"
)

// GenerateManifest builds the Kubernetes manifest (Secret, ServiceAccount,
// ClusterRoleBinding, Deployment) used to deploy the Connector inside a
// target cluster. The image and server URL are injected so the manifest is
// always consistent with the platform configuration.
func GenerateManifest(serverURL, token, image string) string {
	serverURL = strings.TrimSpace(serverURL)
	token = strings.TrimSpace(token)
	image = strings.TrimSpace(image)
	// JSON-encode the string values so the YAML is always valid regardless
	// of special characters.
	tokenJSON := fmt.Sprintf("%q", token)
	serverJSON := fmt.Sprintf("%q", serverURL)
	imageJSON := fmt.Sprintf("%q", image)
	tokenHashJSON := fmt.Sprintf("%q", tokenHash(token))
	return fmt.Sprintf(`apiVersion: v1
kind: Secret
metadata:
  name: kite-connector-token
  namespace: kube-system
type: Opaque
stringData:
  token: %s
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: kite-connector
  namespace: kube-system
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: kite-connector
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
  - kind: ServiceAccount
    name: kite-connector
    namespace: kube-system
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kite-connector
  namespace: kube-system
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: kite-connector
  template:
    metadata:
      annotations:
        kite.kubernetes.io/connector-token-hash: %s
      labels:
        app.kubernetes.io/name: kite-connector
    spec:
      serviceAccountName: kite-connector
      containers:
        - name: connector
          image: %s
          command:
            - /app/kite
          args:
            - connector
            - --server=$(KITE_SERVER)
            - --token=$(CONNECTOR_TOKEN)
          env:
            - name: KITE_SERVER
              value: %s
            - name: CONNECTOR_TOKEN
              valueFrom:
                secretKeyRef:
                  name: kite-connector-token
                  key: token
`, tokenJSON, tokenHashJSON, imageJSON, serverJSON)
}
