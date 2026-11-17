import yaml from 'js-yaml'
import { Deployment } from 'kubernetes-types/apps/v1'
import { Container, Toleration, Volume } from 'kubernetes-types/core/v1'

export interface KeyValueForm {
  key: string
  value: string
}

export interface DeploymentStrategyForm {
  type: 'RollingUpdate' | 'Recreate'
  maxUnavailable: RollingValueForm
  maxSurge: RollingValueForm
}

export interface RollingValueForm {
  value: number | ''
  unit: 'pods' | 'percent'
}

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
  pullPolicy?: 'Always' | 'IfNotPresent' | 'Never'
  env?: Container['env']
  envFrom?: Container['envFrom']
  runtimeEnabled: boolean
  runtimeMode: 'command' | 'shell'
  shellPath: string
  shellScript: string
  command?: Container['command']
  args?: Container['args']
  lifecycle?: Container['lifecycle']
  livenessProbe?: Container['livenessProbe']
  readinessProbe?: Container['readinessProbe']
  startupProbe?: Container['startupProbe']
  resources: {
    requests: { cpu: string; memory: string }
    limits: { cpu: string; memory: string }
    customResources: KeyValueForm[]
  }
  volumeMounts?: VolumeMountForm[]
}

export interface PodSpecForm {
  volumes?: Array<VolumeForm>
  imagePullSecrets: string[]
  nodeSelector: KeyValueForm[]
  tolerations: Toleration[]
}

export interface DeploymentFormData {
  name: string
  namespace: string
  replicas: number
  labels: KeyValueForm[]
  annotations: KeyValueForm[]
  podLabels: KeyValueForm[]
  podAnnotations: KeyValueForm[]
  strategy: DeploymentStrategyForm
  minReadySeconds: number
  podSpec: PodSpecForm
  containers: ContainerConfig[]
}

export const createDefaultContainer = (index: number): ContainerConfig => ({
  name: `container-${index + 1}`,
  image: '',
  pullPolicy: 'IfNotPresent',
  runtimeEnabled: false,
  runtimeMode: 'command',
  shellPath: '/bin/sh',
  shellScript: '',
  resources: {
    requests: { cpu: '', memory: '' },
    limits: { cpu: '', memory: '' },
    customResources: [],
  },
})

export const initialFormData: DeploymentFormData = {
  name: '',
  namespace: 'default',
  replicas: 1,
  labels: [{ key: 'app', value: '' }],
  annotations: [],
  podLabels: [{ key: 'app', value: '' }],
  podAnnotations: [],
  strategy: {
    type: 'RollingUpdate',
    maxUnavailable: { value: 25, unit: 'percent' },
    maxSurge: { value: 25, unit: 'percent' },
  },
  minReadySeconds: 0,
  podSpec: {
    imagePullSecrets: [],
    nodeSelector: [],
    tolerations: [],
  },
  containers: [createDefaultContainer(0)],
}

function hasValidEntries(entries: KeyValueForm[], requireValue: boolean) {
  return entries.every(
    (entry) => entry.key && (!requireValue || entry.value !== '')
  )
}

function isValidRollingValue(value: RollingValueForm) {
  return (
    value.value !== '' &&
    Number.isInteger(value.value) &&
    value.value >= 0 &&
    (value.unit === 'pods' || value.value <= 100)
  )
}

function isValidToleration(toleration: Toleration) {
  if (toleration.operator === 'Exists') {
    if (toleration.value) return false
  } else if (!toleration.key) {
    return false
  }

  return (
    toleration.tolerationSeconds === undefined ||
    (toleration.effect === 'NoExecute' &&
      Number.isInteger(toleration.tolerationSeconds) &&
      toleration.tolerationSeconds >= 0)
  )
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
        formData.labels.length > 0 &&
        hasValidEntries(formData.labels, true) &&
        hasValidEntries(formData.annotations, false)
      )
    case 2:
      if (
        formData.podLabels.length === 0 ||
        !hasValidEntries(formData.podLabels, true) ||
        !hasValidEntries(formData.podAnnotations, false) ||
        formData.podSpec.imagePullSecrets.some((secret) => !secret) ||
        new Set(formData.podSpec.imagePullSecrets).size !==
          formData.podSpec.imagePullSecrets.length ||
        !hasValidEntries(formData.podSpec.nodeSelector, true) ||
        !formData.podSpec.tolerations.every(isValidToleration) ||
        !Number.isInteger(formData.minReadySeconds) ||
        formData.minReadySeconds < 0
      ) {
        return false
      }
      if (
        formData.strategy.type === 'RollingUpdate' &&
        (!isValidRollingValue(formData.strategy.maxUnavailable) ||
          !isValidRollingValue(formData.strategy.maxSurge) ||
          (formData.strategy.maxUnavailable.value === 0 &&
            formData.strategy.maxSurge.value === 0))
      ) {
        return false
      }
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
      return formData.containers.every(
        (container) =>
          container.image &&
          container.name &&
          validateContainerRuntime(container) &&
          validateContainerResources(container) &&
          validateContainerProbes(container)
      )
    default:
      return true
  }
}

function buildKeyValueRecord(
  entries: KeyValueForm[],
  includeEmptyValues = false
) {
  return entries.reduce<Record<string, string>>((values, entry) => {
    if (entry.key && (includeEmptyValues || entry.value)) {
      values[entry.key] = entry.value
    }
    return values
  }, {})
}

function buildRollingValue(value: RollingValueForm): number | string {
  return value.unit === 'percent' ? `${value.value}%` : value.value
}

function isValidPort(port: number | string | undefined) {
  return (
    typeof port === 'number' &&
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535
  )
}

function isValidProbe(
  probe: Container['livenessProbe'],
  allowSuccessThreshold = false
) {
  if (!probe) return true

  const actions = [probe.httpGet, probe.tcpSocket, probe.exec].filter(Boolean)
  if (actions.length !== 1) return false

  if (probe.httpGet && !isValidPort(probe.httpGet.port)) return false
  if (probe.tcpSocket && !isValidPort(probe.tcpSocket.port)) return false
  if (probe.exec && !probe.exec.command?.some((part) => part.trim()))
    return false
  if (
    probe.httpGet?.httpHeaders?.some(
      (header) => !header.name.trim() || !header.value.trim()
    )
  ) {
    return false
  }

  if (
    probe.initialDelaySeconds !== undefined &&
    (!Number.isInteger(probe.initialDelaySeconds) ||
      probe.initialDelaySeconds < 0)
  ) {
    return false
  }

  if (
    !allowSuccessThreshold &&
    probe.successThreshold !== undefined &&
    probe.successThreshold !== 1
  ) {
    return false
  }

  return [
    probe.periodSeconds,
    probe.timeoutSeconds,
    probe.successThreshold,
    probe.failureThreshold,
  ].every(
    (value) => value === undefined || (Number.isInteger(value) && value >= 1)
  )
}

export function validateContainerProbes(container: ContainerConfig) {
  return (
    isValidProbe(container.livenessProbe) &&
    isValidProbe(container.readinessProbe, true) &&
    isValidProbe(container.startupProbe)
  )
}

export function validateContainerRuntime(container: ContainerConfig) {
  return (
    !container.runtimeEnabled ||
    container.runtimeMode !== 'shell' ||
    !!(container.shellPath.trim() && container.shellScript.trim())
  )
}

export function validateContainerResources(container: ContainerConfig) {
  const resourceNames = new Set<string>()
  const resourceNamePattern =
    /^(?:[a-z0-9](?:[-a-z0-9]*[a-z0-9])?\.)*[a-z0-9](?:[-a-z0-9]*[a-z0-9])?\/[A-Za-z0-9](?:[-._A-Za-z0-9]*[A-Za-z0-9])?$/

  return container.resources.customResources.every(({ key, value }) => {
    if (
      !resourceNamePattern.test(key) ||
      !/^[1-9]\d*$/.test(value) ||
      resourceNames.has(key)
    ) {
      return false
    }

    resourceNames.add(key)
    return true
  })
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
      cfg.resources.requests.cpu ||
      cfg.resources.requests.memory ||
      cfg.resources.customResources.length > 0
    const hasLimits =
      cfg.resources.limits.cpu ||
      cfg.resources.limits.memory ||
      cfg.resources.customResources.length > 0
    const customResources = buildKeyValueRecord(cfg.resources.customResources)
    const command = cfg.runtimeEnabled
      ? cfg.runtimeMode === 'shell'
        ? [cfg.shellPath, '-c']
        : cfg.command
      : undefined
    const args = cfg.runtimeEnabled
      ? cfg.runtimeMode === 'shell'
        ? cfg.shellScript
          ? [cfg.shellScript]
          : undefined
        : cfg.args
      : undefined

    return {
      name: cfg.name,
      image: cfg.image,
      ...(cfg.pullPolicy && {
        imagePullPolicy: cfg.pullPolicy,
      }),
      ...(command?.length && { command }),
      ...(args?.length && { args }),
      ...(cfg.runtimeEnabled && cfg.lifecycle && { lifecycle: cfg.lifecycle }),
      ...(cfg.livenessProbe && { livenessProbe: cfg.livenessProbe }),
      ...(cfg.readinessProbe && { readinessProbe: cfg.readinessProbe }),
      ...(cfg.startupProbe && { startupProbe: cfg.startupProbe }),
      ...(cfg.env &&
        cfg.env.length > 0 && {
          env: cfg.env.filter(
            (env) => env.name && (env.value || env.valueFrom)
          ),
        }),
      ...(cfg.envFrom &&
        cfg.envFrom.length > 0 && {
          envFrom: cfg.envFrom.filter(
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
              ...customResources,
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
              ...customResources,
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
  const labelsObj = buildKeyValueRecord(formData.labels)
  const annotationsObj = buildKeyValueRecord(formData.annotations, true)
  const podLabelsObj = buildKeyValueRecord(formData.podLabels)
  const podAnnotationsObj = buildKeyValueRecord(formData.podAnnotations, true)
  const nodeSelector = buildKeyValueRecord(formData.podSpec.nodeSelector)

  if (!labelsObj.app && formData.name) {
    labelsObj.app = formData.name
  }
  if (!podLabelsObj.app && formData.name) {
    podLabelsObj.app = formData.name
  }

  const deployment: Deployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: formData.name,
      namespace: formData.namespace,
      labels: labelsObj,
      ...(Object.keys(annotationsObj).length > 0 && {
        annotations: annotationsObj,
      }),
    },
    spec: {
      replicas: formData.replicas,
      minReadySeconds: formData.minReadySeconds,
      strategy: {
        type: formData.strategy.type,
        ...(formData.strategy.type === 'RollingUpdate' && {
          rollingUpdate: {
            maxUnavailable: buildRollingValue(formData.strategy.maxUnavailable),
            maxSurge: buildRollingValue(formData.strategy.maxSurge),
          },
        }),
      },
      selector: { matchLabels: podLabelsObj },
      template: {
        metadata: {
          labels: podLabelsObj,
          ...(Object.keys(podAnnotationsObj).length > 0 && {
            annotations: podAnnotationsObj,
          }),
        },
        spec: {
          volumes: buildVolumes(formData.podSpec?.volumes || []),
          ...(formData.podSpec.imagePullSecrets.length > 0 && {
            imagePullSecrets: formData.podSpec.imagePullSecrets.map((name) => ({
              name,
            })),
          }),
          ...(Object.keys(nodeSelector).length > 0 && { nodeSelector }),
          ...(formData.podSpec.tolerations.length > 0 && {
            tolerations: formData.podSpec.tolerations,
          }),
          containers: buildContainers(formData.containers),
        },
      },
    },
  }

  return yaml.dump(deployment, { indent: 2, noRefs: true })
}
