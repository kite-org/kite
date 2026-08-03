package resources

import (
	"encoding/json"

	"github.com/zxh326/kite/pkg/cluster"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	cmdutil "k8s.io/kubectl/pkg/cmd/util"
	"k8s.io/kubectl/pkg/polymorphichelpers"
)

// GroupKinds for the workload kinds that support kubectl-style rollout
// history and rollback, used to look up the matching kubectl Rollbacker.
var (
	deploymentGroupKind  = schema.GroupKind{Group: "apps", Kind: "Deployment"}
	statefulSetGroupKind = schema.GroupKind{Group: "apps", Kind: "StatefulSet"}
	daemonSetGroupKind   = schema.GroupKind{Group: "apps", Kind: "DaemonSet"}
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

// rollbackWorkload applies revision targetRevision to obj by delegating to
// kubectl's own Rollbacker for groupKind - the same code path `kubectl
// rollout undo` uses - instead of Kite reimplementing the per-kind template
// swap (Deployment/ReplicaSet) or strategic-merge-patch application
// (StatefulSet/DaemonSet ControllerRevision) itself. obj only needs its
// Namespace/Name set; the Rollbacker re-fetches the live object by name via
// the typed clientset.
func rollbackWorkload(cs *cluster.ClientSet, groupKind schema.GroupKind, obj runtime.Object, targetRevision int64) error {
	rollbacker, err := polymorphichelpers.RollbackerFor(groupKind, cs.K8sClient.ClientSet)
	if err != nil {
		return err
	}
	_, err = rollbacker.Rollback(obj, nil, targetRevision, cmdutil.DryRunNone)
	return err
}
