package resources

import (
	"encoding/json"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// WorkloadRevisionItem is the common shape returned by the revisions endpoint
// for every workload kind that supports Kubernetes rollout history
// (Deployments, StatefulSets, DaemonSets). RevisionObject holds the name of
// the underlying object the revision is derived from (a ReplicaSet for
// Deployments, a ControllerRevision for StatefulSets/DaemonSets). Replicas is
// only meaningful for Deployments, where the owned ReplicaSet tracks its own
// replica count; StatefulSet/DaemonSet revisions are point-in-time template
// snapshots with no replica count of their own, so it's omitted for those.
type WorkloadRevisionItem struct {
	Revision       int64       `json:"revision"`
	RevisionObject string      `json:"revisionObject"`
	ChangeCause    string      `json:"changeCause,omitempty"`
	Images         []string    `json:"images"`
	Replicas       *int32      `json:"replicas,omitempty"`
	CreatedAt      metav1.Time `json:"createdAt"`
	Current        bool        `json:"current"`
}

type workloadRollbackRequest struct {
	Revision    int64  `json:"revision"`
	ChangeCause string `json:"changeCause"`
}

// controllerRevisionTemplatePatch mirrors the strategic-merge-patch shape
// kubectl stores in a StatefulSet/DaemonSet ControllerRevision's Data field:
// {"spec":{"template":{...pod template..., "$patch":"replace"}}}. Decoding
// into this struct (rather than applying the patch to the live object) is
// enough to read back the pod template that revision represents.
type controllerRevisionTemplatePatch struct {
	Spec struct {
		Template corev1.PodTemplateSpec `json:"template"`
	} `json:"spec"`
}

func controllerRevisionImages(data []byte) []string {
	var patch controllerRevisionTemplatePatch
	if err := json.Unmarshal(data, &patch); err != nil {
		return nil
	}
	images := make([]string, 0, len(patch.Spec.Template.Spec.Containers))
	for _, container := range patch.Spec.Template.Spec.Containers {
		images = append(images, container.Image)
	}
	return images
}

// withChangeCauseAnnotation merges a kubernetes.io/change-cause annotation
// into a ControllerRevision's raw strategic-merge-patch document, so the
// rollout's template change and its change-cause can be applied to the live
// object in a single PATCH call instead of two separate writes.
func withChangeCauseAnnotation(rawPatch []byte, changeCause string) ([]byte, error) {
	var doc map[string]interface{}
	if err := json.Unmarshal(rawPatch, &doc); err != nil {
		return nil, err
	}
	metadata, _ := doc["metadata"].(map[string]interface{})
	if metadata == nil {
		metadata = map[string]interface{}{}
	}
	annotations, _ := metadata["annotations"].(map[string]interface{})
	if annotations == nil {
		annotations = map[string]interface{}{}
	}
	annotations[deploymentChangeCauseAnnotation] = changeCause
	metadata["annotations"] = annotations
	doc["metadata"] = metadata
	return json.Marshal(doc)
}
