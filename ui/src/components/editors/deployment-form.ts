import yaml from 'js-yaml'
import { Deployment } from 'kubernetes-types/apps/v1'
import { Container, Volume } from 'kubernetes-types/core/v1'

export interface VolumeForm {
  name: string
  sourceType: 'emptyDir' | 'hostPath' | 'configMap' | 'secret' | 'pvc'
  options?: {
    path?: string
    configMapName?: string
    secretName?: string
    claimName?: string
  }
}

export interface VolumeMountForm {
  name: string
  mountPath: string
  subPath?: string
  readOnly?: boolean
}

export interface ContainerConfig {
  name: string
  image: string
  port?: number
  pullPolicy: 'Always' | 'IfNotPresent' | 'Never'
  resources: {
    requests: { cpu: string; memory: string }
    limits: { cpu: string; memory: string }
  }
  volumeMounts?: VolumeMountForm[]
  container: Container
}

export interface PodSpecForm {
  volumes?: Array<VolumeForm>
}

export interface DeploymentFormData {
  name: string
  namespace: string
  replicas: number
  labels: Array<{ key: string; value: string }>
  podSpec: PodSpecForm
  containers: ContainerConfig[]
}

export const createDefaultContainer = (index: number): ContainerConfig => ({
  name: `container-${index + 1}`,
  image: '',
  pullPolicy: 'IfNotPresent',
  resources: {
    requests: { cpu: '', memory: '' },
    limits: { cpu: '', memory: '' },
  },
  container: {
    name: `container-${index + 1}`,
    image: '',
  },
})

export const initialFormData: DeploymentFormData = {
  name: '',
  namespace: 'default',
  replicas: 1,
  labels: [{ key: 'app', value: '' }],
  podSpec: {},
  containers: [createDefaultContainer(0)],
}

export function validateStep(
  formData: DeploymentFormData,
  stepNum: number
): boolean {
  switch (stepNum) {
    case 1:
      return !!(
        formData.name &&
        formData.namespace &&
        formData.replicas > 0 &&
        formData.labels.every((label) => label.key && label.value)
      )
    case 2:
      for (const volume of formData.podSpec?.volumes || []) {
        if (!volume.name) return false
        if (volume.sourceType === 'hostPath' && !volume.options?.path)
          return false
        if (volume.sourceType === 'configMap' && !volume.options?.configMapName)
          return false
        if (volume.sourceType === 'secret' && !volume.options?.secretName)
          return false
        if (volume.sourceType === 'pvc' && !volume.options?.claimName)
          return false
      }
      return true
    case 3:
      return formData.containers.every((c) => c.image && c.name)
    default:
      return true
  }
}

function buildVolumes(volumeForms: VolumeForm[]): Volume[] {
  return volumeForms.map((volume): Volume => {
    switch (volume.sourceType) {
      case 'emptyDir':
        return { name: volume.name, emptyDir: {} }
      case 'hostPath':
        return {
          name: volume.name,
          hostPath: { path: volume.options?.path || '/data' },
        }
      case 'configMap':
        return {
          name: volume.name,
          configMap: { name: volume.options?.configMapName || '' },
        }
      case 'secret':
        return {
          name: volume.name,
          secret: { secretName: volume.options?.secretName || '' },
        }
      case 'pvc':
        return {
          name: volume.name,
          persistentVolumeClaim: {
            claimName: volume.options?.claimName || '',
          },
        }
      default:
        return { name: volume.name }
    }
  })
}

function buildContainers(configs: ContainerConfig[]): Container[] {
  return configs.map((cfg) => {
    const hasRequests =
      cfg.resources.requests.cpu || cfg.resources.requests.memory
    const hasLimits = cfg.resources.limits.cpu || cfg.resources.limits.memory

    return {
      name: cfg.name,
      image: cfg.image,
      imagePullPolicy: cfg.pullPolicy,
      ...(cfg.container.env &&
        cfg.container.env.length > 0 && {
          env: cfg.container.env.filter(
            (env) => env.name && (env.value || env.valueFrom)
          ),
        }),
      ...(cfg.container.envFrom &&
        cfg.container.envFrom.length > 0 && {
          envFrom: cfg.container.envFrom.filter(
            (source) => source.configMapRef?.name || source.secretRef?.name
          ),
        }),
      ...(cfg.port && { ports: [{ containerPort: cfg.port }] }),
      ...((hasRequests || hasLimits) && {
        resources: {
          ...(hasRequests && {
            requests: {
              ...(cfg.resources.requests.cpu && {
                cpu: cfg.resources.requests.cpu,
              }),
              ...(cfg.resources.requests.memory && {
                memory: cfg.resources.requests.memory,
              }),
            },
          }),
          ...(hasLimits && {
            limits: {
              ...(cfg.resources.limits.cpu && {
                cpu: cfg.resources.limits.cpu,
              }),
              ...(cfg.resources.limits.memory && {
                memory: cfg.resources.limits.memory,
              }),
            },
          }),
        },
      }),
      ...(cfg.volumeMounts &&
        cfg.volumeMounts.length > 0 && {
          volumeMounts: cfg.volumeMounts.map((mount) => ({
            name: mount.name,
            mountPath: mount.mountPath,
            subPath: mount.subPath,
            readOnly: mount.readOnly === true,
          })),
        }),
    }
  })
}

export function generateDeploymentYaml(formData: DeploymentFormData): string {
  const labelsObj = formData.labels.reduce(
    (acc, label) => {
      if (label.key && label.value) acc[label.key] = label.value
      return acc
    },
    {} as Record<string, string>
  )

  if (!labelsObj.app && formData.name) {
    labelsObj.app = formData.name
  }

  const deployment: Deployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: formData.name,
      namespace: formData.namespace,
      labels: labelsObj,
    },
    spec: {
      replicas: formData.replicas,
      selector: { matchLabels: labelsObj },
      template: {
        metadata: { labels: labelsObj },
        spec: {
          volumes: buildVolumes(formData.podSpec?.volumes || []),
          containers: buildContainers(formData.containers),
        },
      },
    },
  }

  return yaml.dump(deployment, { indent: 2, noRefs: true })
}
