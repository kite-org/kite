package resources

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"github.com/zxh326/kite/pkg/utils"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (h *PodHandler) Debug(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)
	namespace := c.Param("namespace")
	if !rbac.CanAccess(user, string(common.Pods), string(common.VerbExec), cs.Name, namespace) {
		c.JSON(http.StatusForbidden, gin.H{"error": rbac.NoAccess(user.Key(), string(common.VerbExec), string(common.Pods), namespace, cs.Name)})
		return
	}

	version, err := parseKubeSemver(cs.Version)
	if err != nil || version.Major < 1 || (version.Major == 1 && version.Minor < 25) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pod debug requires kubernetes >= 1.25.0"})
		return
	}

	var req struct {
		Image               string   `json:"image"`
		TargetContainerName string   `json:"targetContainerName"`
		Command             []string `json:"command"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Image = strings.TrimSpace(req.Image)
	req.TargetContainerName = strings.TrimSpace(req.TargetContainerName)
	if req.Image == "" || req.TargetContainerName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "image and targetContainerName are required"})
		return
	}
	if len(req.Command) > 0 && strings.TrimSpace(req.Command[0]) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "command must not start with an empty argument"})
		return
	}

	pods := cs.K8sClient.ClientSet.CoreV1().Pods(namespace)
	pod, err := pods.Get(c.Request.Context(), c.Param("name"), metav1.GetOptions{})
	if err != nil {
		status := http.StatusInternalServerError
		if apiStatus, ok := err.(apierrors.APIStatus); ok {
			status = int(apiStatus.Status().Code)
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	if _, mirror := pod.Annotations[corev1.MirrorPodAnnotationKey]; mirror {
		c.JSON(http.StatusBadRequest, gin.H{"error": "static pods do not support ephemeral containers"})
		return
	}
	if pod.DeletionTimestamp != nil || pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot debug a terminating or completed pod"})
		return
	}
	if (pod.Spec.OS != nil && pod.Spec.OS.Name == corev1.Windows) || pod.Spec.NodeSelector[corev1.LabelOSStable] == string(corev1.Windows) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pod debug does not support Windows pods"})
		return
	}

	targetExists := false
	for _, containers := range [][]corev1.Container{pod.Spec.Containers, pod.Spec.InitContainers} {
		for _, container := range containers {
			if container.Name == req.TargetContainerName {
				targetExists = true
			}
		}
	}
	if !targetExists {
		c.JSON(http.StatusBadRequest, gin.H{"error": "target container does not exist in the pod"})
		return
	}
	containerName := "debugger-" + utils.RandomString(8)

	previousPod := pod.DeepCopy()
	pod.Spec.EphemeralContainers = append(pod.Spec.EphemeralContainers, corev1.EphemeralContainer{
		EphemeralContainerCommon: corev1.EphemeralContainerCommon{
			Name:    containerName,
			Image:   req.Image,
			Command: req.Command,
			Stdin:   true,
			TTY:     true,
		},
		TargetContainerName: req.TargetContainerName,
	})
	updatedPod, err := pods.UpdateEphemeralContainers(c.Request.Context(), pod.Name, pod, metav1.UpdateOptions{})
	if err != nil {
		h.recordHistory(c, "patch", previousPod, pod, false, err.Error())
		status := http.StatusInternalServerError
		if apiStatus, ok := err.(apierrors.APIStatus); ok {
			status = int(apiStatus.Status().Code)
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	h.recordHistory(c, "patch", previousPod, updatedPod, true, "")
	c.JSON(http.StatusOK, gin.H{"pod": updatedPod, "containerName": containerName})
}

func (h *PodHandler) DebugCopy(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)
	namespace := c.Param("namespace")
	for _, verb := range []common.Verb{common.VerbGet, common.VerbExec} {
		if !rbac.CanAccess(user, string(common.Pods), string(verb), cs.Name, namespace) {
			c.JSON(http.StatusForbidden, gin.H{"error": rbac.NoAccess(user.Key(), string(verb), string(common.Pods), namespace, cs.Name)})
			return
		}
	}

	var req struct {
		CopyTo              string   `json:"copyTo"`
		TargetContainerName string   `json:"targetContainerName"`
		Image               string   `json:"image"`
		Command             []string `json:"command"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.CopyTo = strings.TrimSpace(req.CopyTo)
	req.TargetContainerName = strings.TrimSpace(req.TargetContainerName)
	req.Image = strings.TrimSpace(req.Image)
	if req.CopyTo == "" || req.TargetContainerName == "" || len(req.Command) == 0 || strings.TrimSpace(req.Command[0]) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "copyTo, targetContainerName and command are required"})
		return
	}
	if req.CopyTo == c.Param("name") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "copyTo must differ from the source pod name"})
		return
	}

	pods := cs.K8sClient.ClientSet.CoreV1().Pods(namespace)
	pod, err := pods.Get(c.Request.Context(), c.Param("name"), metav1.GetOptions{})
	if err != nil {
		status := http.StatusInternalServerError
		if apiStatus, ok := err.(apierrors.APIStatus); ok {
			status = int(apiStatus.Status().Code)
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	if pod.DeletionTimestamp != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot copy a terminating pod for debugging"})
		return
	}
	if (pod.Spec.OS != nil && pod.Spec.OS.Name == corev1.Windows) || pod.Spec.NodeSelector[corev1.LabelOSStable] == string(corev1.Windows) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pod debug does not support Windows pods"})
		return
	}

	copied := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      req.CopyTo,
			Namespace: namespace,
			Annotations: map[string]string{
				"kite.io/debug-container": req.TargetContainerName,
			},
		},
		Spec: *pod.Spec.DeepCopy(),
	}
	copied.Spec.EphemeralContainers = nil
	copied.Spec.NodeName = ""
	copied.Spec.ActiveDeadlineSeconds = nil
	copied.Spec.SchedulingGates = nil
	copied.Spec.SchedulingGroup = nil
	copied.Spec.RestartPolicy = corev1.RestartPolicyNever
	var target *corev1.Container
	for _, containers := range [][]corev1.Container{copied.Spec.Containers, copied.Spec.InitContainers} {
		for i := range containers {
			containers[i].LivenessProbe = nil
			containers[i].ReadinessProbe = nil
			containers[i].StartupProbe = nil
			if containers[i].Name == req.TargetContainerName {
				target = &containers[i]
			}
		}
	}
	if target == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "target container does not exist in the pod"})
		return
	}
	target.Command = req.Command
	target.Args = nil
	target.Stdin = true
	target.StdinOnce = false
	target.TTY = true
	target.Lifecycle = nil
	target.RestartPolicy = nil
	target.RestartPolicyRules = nil
	if req.Image != "" {
		target.Image = req.Image
	}

	createdPod, err := pods.Create(c.Request.Context(), copied, metav1.CreateOptions{})
	if err != nil {
		h.recordHistory(c, "create", nil, copied, false, err.Error())
		status := http.StatusInternalServerError
		if apiStatus, ok := err.(apierrors.APIStatus); ok {
			status = int(apiStatus.Status().Code)
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	h.recordHistory(c, "create", nil, createdPod, true, "")
	c.JSON(http.StatusCreated, gin.H{"pod": createdPod, "containerName": req.TargetContainerName})
}
