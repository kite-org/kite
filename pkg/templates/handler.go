package templates

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/model"
)

type CreateTemplateRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	YAML        string `json:"yaml" binding:"required"`
}

type UpdateTemplateRequest struct {
	Description string `json:"description"`
	YAML        string `json:"yaml" binding:"required"`
}

func ListTemplates(c *gin.Context) {
	var templates []model.ResourceTemplate
	if err := model.DB.Find(&templates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, templates)
}

func CreateTemplate(c *gin.Context) {
	var req CreateTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	template := model.ResourceTemplate{
		Name:        req.Name,
		Description: req.Description,
		YAML:        req.YAML,
	}

	if err := model.DB.Create(&template).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, template)
}

func UpdateTemplate(c *gin.Context) {
	id := c.Param("id")
	var template model.ResourceTemplate
	if err := model.DB.First(&template, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Template not found"})
		return
	}

	var req UpdateTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	template.Description = req.Description
	template.YAML = req.YAML

	if err := model.DB.Save(&template).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, template)
}

func DeleteTemplate(c *gin.Context) {
	id := c.Param("id")
	if err := model.DB.Delete(&model.ResourceTemplate{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Template deleted"})
}

func InitTemplates() {
	var count int64
	model.DB.Model(&model.ResourceTemplate{}).Count(&count)
	if count > 0 {
		return
	}

	templates := []model.ResourceTemplate{
		{
			Name:        "Pod",
			Description: "A basic Pod with a single container",
			YAML: `apiVersion: v1
kind: Pod
metadata:
  name: example-pod
  namespace: default
  labels:
    app: example
spec:
  containers:
  - name: nginx
    image: nginx:1.21
    ports:
    - containerPort: 80
    resources:
      requests:
        memory: "64Mi"
        cpu: "250m"
      limits:
        memory: "128Mi"
        cpu: "500m"`,
		},
		{
			Name:        "Deployment",
			Description: "A Deployment with 3 replicas",
			YAML: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: example-deployment
  namespace: default
  labels:
    app: example
spec:
  replicas: 3
  selector:
    matchLabels:
      app: example
  template:
    metadata:
      labels:
        app: example
    spec:
      containers:
      - name: nginx
        image: nginx:1.21
        ports:
        - containerPort: 80
        resources:
          requests:
            memory: "64Mi"
            cpu: "250m"
          limits:
            memory: "128Mi"
            cpu: "500m"`,
		},
		{
			Name:        "StatefulSet",
			Description: "A StatefulSet with persistent storage",
			YAML: `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: example-statefulset
  namespace: default
spec:
  serviceName: "example-service"
  replicas: 3
  selector:
    matchLabels:
      app: example
  template:
    metadata:
      labels:
        app: example
    spec:
      containers:
      - name: nginx
        image: nginx:1.21
        ports:
        - containerPort: 80
        volumeMounts:
        - name: www
          mountPath: /usr/share/nginx/html
        resources:
          requests:
            memory: "64Mi"
            cpu: "250m"
          limits:
            memory: "128Mi"
            cpu: "500m"
  volumeClaimTemplates:
  - metadata:
      name: www
    spec:
      accessModes: [ "ReadWriteOnce" ]
      resources:
        requests:
          storage: 1Gi`,
		},
		{
			Name:        "Job",
			Description: "A Job that runs a task to completion",
			YAML: `apiVersion: batch/v1
kind: Job
metadata:
  name: example-job
  namespace: default
spec:
  template:
    spec:
      containers:
      - name: busybox
        image: busybox:1.35
        command: ['sh', '-c']
        args:
        - |
          echo "Starting job..."
          sleep 30
          echo "Job completed successfully!"
        resources:
          requests:
            memory: "32Mi"
            cpu: "100m"
          limits:
            memory: "64Mi"
            cpu: "200m"
      restartPolicy: Never
  backoffLimit: 4`,
		},
		{
			Name:        "CronJob",
			Description: "A CronJob that runs on a schedule",
			YAML: `apiVersion: batch/v1
kind: CronJob
metadata:
  name: example-cronjob
  namespace: default
spec:
  schedule: "0 2 * * *"  # Run daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: busybox
            image: busybox:1.35
            command: ['sh', '-c']
            args:
            - |
              echo "Running scheduled task..."
              date
              echo "Task completed!"
            resources:
              requests:
                memory: "32Mi"
                cpu: "100m"
              limits:
                memory: "64Mi"
                cpu: "200m"
          restartPolicy: OnFailure`,
		},
		{
			Name:        "Service",
			Description: "A Service to expose applications",
			YAML: `apiVersion: v1
kind: Service
metadata:
  name: example-service
  namespace: default
  labels:
    app: example
spec:
  selector:
    app: example
  ports:
  - name: http
    port: 80
    targetPort: 80
    protocol: TCP
  type: ClusterIP`,
		},
		{
			Name:        "ConfigMap",
			Description: "A ConfigMap to store configuration data",
			YAML: `apiVersion: v1
kind: ConfigMap
metadata:
  name: example-configmap
  namespace: default
data:
  database_url: "postgresql://localhost:5432/mydb"
  debug: "true"
  max_connections: "100"
  config.yaml: |
    server:
      port: 8080
      host: 0.0.0.0
    logging:
      level: info`,
		},
		{
			Name:        "Secret",
			Description: "A Secret to store sensitive data",
			YAML: `apiVersion: v1
kind: Secret
metadata:
  name: example-secret
  namespace: default
type: Opaque
data:
  username: YWRtaW4=  # base64 encoded "admin"
  password: MWYyZDFlMmU2N2Rm  # base64 encoded "1f2d1e2e67df"
stringData:
  database-url: "postgresql://user:pass@localhost:5432/mydb"`,
		},
		{
			Name:        "Daemonset",
			Description: "A DaemonSet to run pods on all nodes",
			YAML: `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: example-daemonset
spec:
  selector:
    matchLabels:
      app: example
  template:
    metadata:
      labels:
        app: example
    spec:
      containers:
        - name: busybox
          image: busybox:1.35
          args:
            - /bin/sh
            - -c
            - 'while true; do echo alive; sleep 60; done'
`,
		},
		{
			Name:        "Ingress",
			Description: "An Ingress to route external traffic",
			YAML: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: example-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
    - http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: example-service
                port:
                  number: 80
`,
		},
		{
			Name:        "Namespace",
			Description: "A Namespace for resource isolation",
			YAML: `apiVersion: v1
kind: Namespace
metadata:
  name: example-namespace
`,
		},
	}

	for _, t := range templates {
		model.DB.Create(&t)
	}
}
