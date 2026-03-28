import { useState } from 'react'
import {
  Container,
  ContainerState,
  ContainerStatus,
} from 'kubernetes-types/core/v1'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { cn, formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

const sectionLabelClassName =
  'text-balance text-xs font-medium text-muted-foreground uppercase'
const bodyTextClassName = 'text-sm text-pretty'

function renderState(state: ContainerState) {
  if (state.running) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="default" className="bg-green-600">
          Running
        </Badge>
        {state.running.startedAt && (
          <span className="text-xs text-muted-foreground">
            since {formatDate(state.running.startedAt)}
          </span>
        )}
      </div>
    )
  }
  if (state.waiting) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary">Waiting</Badge>
        {state.waiting.reason && (
          <span className={bodyTextClassName}>{state.waiting.reason}</span>
        )}
        {state.waiting.message && (
          <span className="text-xs text-muted-foreground text-pretty">
            {state.waiting.message}
          </span>
        )}
      </div>
    )
  }
  if (state.terminated) {
    return (
      <div className="flex items-center gap-2">
        <Badge
          variant={state.terminated.exitCode === 0 ? 'default' : 'destructive'}
          className="tabular-nums"
        >
          Terminated (exit: {state.terminated.exitCode})
        </Badge>
        {state.terminated.reason && (
          <span className={bodyTextClassName}>{state.terminated.reason}</span>
        )}
        {state.terminated.finishedAt && (
          <span className="text-xs text-muted-foreground">
            finished {formatDate(state.terminated.finishedAt)}
          </span>
        )}
      </div>
    )
  }
  return null
}

export function ContainerInfoCard({
  container,
  status,
  init,
}: {
  container: Container
  status?: ContainerStatus
  init?: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const hasMore =
    (container.ports && container.ports.length > 0) ||
    (container.env && container.env.length > 0) ||
    (container.envFrom && container.envFrom.length > 0) ||
    (container.volumeMounts && container.volumeMounts.length > 0) ||
    !!(container.resources?.requests || container.resources?.limits) ||
    !!(
      container.livenessProbe ||
      container.readinessProbe ||
      container.startupProbe
    ) ||
    !!(status?.imageID || status?.containerID)

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-muted/30 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="default" className="font-medium">
            {container.name}
          </Badge>
          {init && container.restartPolicy !== 'Always' && (
            <Badge variant="outline" className="text-xs">
              Init
            </Badge>
          )}
          {init && container.restartPolicy === 'Always' && (
            <Badge variant="secondary" className="text-xs">
              Sidecar
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <Badge variant={status.ready ? 'default' : 'secondary'}>
              {status.ready ? 'Ready' : 'Not Ready'}
            </Badge>
          )}
          {status && status.restartCount > 0 && (
            <Badge variant="destructive" className="tabular-nums">
              {status.restartCount} restarts
            </Badge>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-4">
        {/* Image row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className={sectionLabelClassName}>Image</Label>
            <p className="text-sm font-mono mt-1 break-all">
              {container.image}
            </p>
          </div>
          <div>
            <Label className={sectionLabelClassName}>Image Pull Policy</Label>
            <p className={cn(bodyTextClassName, 'mt-1')}>
              {container.imagePullPolicy || 'IfNotPresent'}
            </p>
          </div>
          {container.workingDir && (
            <div>
              <Label className={sectionLabelClassName}>Working Directory</Label>
              <p className="text-sm font-mono mt-1">{container.workingDir}</p>
            </div>
          )}
          {(container.stdin || container.tty) && (
            <div>
              <Label className={sectionLabelClassName}>TTY / Stdin</Label>
              <div className="flex gap-2 mt-1">
                {container.tty && (
                  <Badge variant="outline" className="text-xs">
                    TTY
                  </Badge>
                )}
                {container.stdin && (
                  <Badge variant="outline" className="text-xs">
                    Stdin
                  </Badge>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Command */}
        {container.command && container.command.length > 0 && (
          <div>
            <Label className={sectionLabelClassName}>Command</Label>
            <div className="mt-1 bg-muted rounded px-3 py-2">
              {container.command.map((part, i) => (
                <div
                  key={i}
                  className="text-sm font-mono break-all whitespace-pre-wrap"
                >
                  {part}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Args */}
        {container.args && container.args.length > 0 && (
          <div>
            <Label className={sectionLabelClassName}>Args</Label>
            <div className="mt-1 bg-muted rounded px-3 py-2">
              {container.args.map((part, i) => (
                <div
                  key={i}
                  className="text-sm font-mono break-all whitespace-pre-wrap"
                >
                  {part}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* State */}
        {status?.state && (
          <div>
            <Label className={sectionLabelClassName}>State</Label>
            <div className="mt-1">{renderState(status.state)}</div>
          </div>
        )}

        {/* Toggle */}
        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-7 text-xs text-muted-foreground"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <>
                <ChevronDown className="size-3 mr-1" />
                Show less
              </>
            ) : (
              <>
                <ChevronRight className="size-3 mr-1" />
                Show more
              </>
            )}
          </Button>
        )}

        {expanded && (
          <div className="space-y-4">
            {/* Ports */}
            {container.ports && container.ports.length > 0 && (
              <div className="border-t pt-3">
                <Label className={sectionLabelClassName}>Ports</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {container.ports.map((port, i) => (
                    <div key={i} className="flex items-center gap-1 text-sm">
                      <Badge
                        variant="secondary"
                        className="text-xs font-mono tabular-nums"
                      >
                        {port.containerPort}
                      </Badge>
                      {port.protocol && (
                        <span className="text-xs text-muted-foreground">
                          {port.protocol}
                        </span>
                      )}
                      {port.name && (
                        <span className="text-xs text-muted-foreground">
                          ({port.name})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Environment Variables */}
            {((container.env && container.env.length > 0) ||
              (container.envFrom && container.envFrom.length > 0)) && (
              <div className="border-t pt-3">
                <Label className={sectionLabelClassName}>
                  Environment Variables
                  {container.env && container.env.length > 0 && (
                    <span className="ml-1 tabular-nums normal-case">
                      ({container.env.length})
                    </span>
                  )}
                </Label>
                <div className="mt-2 space-y-1">
                  {container.envFrom && container.envFrom.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {container.envFrom.map((src, i) => (
                        <div key={i} className="flex items-center gap-1">
                          {src.configMapRef && (
                            <Badge
                              variant="outline"
                              className="text-xs bg-blue-50 dark:bg-blue-950"
                            >
                              ConfigMap: {src.configMapRef.name}
                              {src.prefix && ` (prefix: ${src.prefix})`}
                            </Badge>
                          )}
                          {src.secretRef && (
                            <Badge
                              variant="outline"
                              className="text-xs bg-green-50 dark:bg-green-950"
                            >
                              Secret: {src.secretRef.name}
                              {src.prefix && ` (prefix: ${src.prefix})`}
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {container.env &&
                    container.env.map((envVar, i) => (
                      <div
                        key={i}
                        className="text-xs font-mono flex gap-1 flex-wrap"
                      >
                        <span className="text-blue-600 dark:text-blue-400">
                          {envVar.name}
                        </span>
                        {envVar.value !== undefined && (
                          <>
                            <span className="text-muted-foreground">=</span>
                            <span className="text-muted-foreground break-all">
                              {envVar.value}
                            </span>
                          </>
                        )}
                        {envVar.valueFrom && (
                          <span className="text-orange-600 dark:text-orange-400">
                            = (from{' '}
                            {envVar.valueFrom.secretKeyRef
                              ? `secret:${envVar.valueFrom.secretKeyRef.name}/${envVar.valueFrom.secretKeyRef.key}`
                              : envVar.valueFrom.configMapKeyRef
                                ? `configmap:${envVar.valueFrom.configMapKeyRef.name}/${envVar.valueFrom.configMapKeyRef.key}`
                                : envVar.valueFrom.fieldRef
                                  ? `field:${envVar.valueFrom.fieldRef.fieldPath}`
                                  : envVar.valueFrom.resourceFieldRef
                                    ? `resource:${envVar.valueFrom.resourceFieldRef.resource}`
                                    : 'ref'}
                            )
                          </span>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Volume Mounts */}
            {container.volumeMounts && container.volumeMounts.length > 0 && (
              <div className="border-t pt-3">
                <Label className={sectionLabelClassName}>
                  Volume Mounts (
                  <span className="tabular-nums">
                    {container.volumeMounts.length}
                  </span>
                  )
                </Label>
                <div className="mt-2 space-y-1">
                  {container.volumeMounts.map((mount, i) => (
                    <div
                      key={i}
                      className="flex flex-wrap items-center gap-2 text-xs"
                    >
                      <Badge variant="outline" className="text-xs font-mono">
                        {mount.name}
                      </Badge>
                      <span className="font-mono text-muted-foreground">
                        {mount.mountPath}
                      </span>
                      {mount.subPath && (
                        <span className="text-muted-foreground">
                          subPath: {mount.subPath}
                        </span>
                      )}
                      {mount.readOnly && (
                        <Badge variant="secondary" className="text-xs">
                          RO
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Resources */}
            {container.resources &&
              (container.resources.requests || container.resources.limits) && (
                <div className="border-t pt-3">
                  <Label className={sectionLabelClassName}>Resources</Label>
                  <div className="mt-2 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                    {container.resources.requests && (
                      <div>
                        <div className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">
                          Requests
                        </div>
                        {container.resources.requests.cpu && (
                          <div className="flex gap-2 text-xs">
                            <span className="text-muted-foreground">CPU:</span>
                            <span className="font-mono tabular-nums">
                              {container.resources.requests.cpu}
                            </span>
                          </div>
                        )}
                        {container.resources.requests.memory && (
                          <div className="flex gap-2 text-xs">
                            <span className="text-muted-foreground">
                              Memory:
                            </span>
                            <span className="font-mono tabular-nums">
                              {container.resources.requests.memory}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    {container.resources.limits && (
                      <div>
                        <div className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">
                          Limits
                        </div>
                        {container.resources.limits.cpu && (
                          <div className="flex gap-2 text-xs">
                            <span className="text-muted-foreground">CPU:</span>
                            <span className="font-mono tabular-nums">
                              {container.resources.limits.cpu}
                            </span>
                          </div>
                        )}
                        {container.resources.limits.memory && (
                          <div className="flex gap-2 text-xs">
                            <span className="text-muted-foreground">
                              Memory:
                            </span>
                            <span className="font-mono tabular-nums">
                              {container.resources.limits.memory}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

            {/* Health Probes */}
            {(container.livenessProbe ||
              container.readinessProbe ||
              container.startupProbe) && (
              <div className="border-t pt-3">
                <Label className={sectionLabelClassName}>Health Checks</Label>
                <div className="mt-2 space-y-1">
                  {[
                    {
                      label: 'Liveness',
                      probe: container.livenessProbe,
                      color: 'bg-green-50 dark:bg-green-950',
                    },
                    {
                      label: 'Readiness',
                      probe: container.readinessProbe,
                      color: 'bg-blue-50 dark:bg-blue-950',
                    },
                    {
                      label: 'Startup',
                      probe: container.startupProbe,
                      color: 'bg-yellow-50 dark:bg-yellow-950',
                    },
                  ]
                    .filter((p) => p.probe)
                    .map(({ label, probe, color }) => (
                      <div
                        key={label}
                        className="flex items-center gap-2 text-xs"
                      >
                        <Badge
                          variant="outline"
                          className={cn('text-xs', color)}
                        >
                          {label}
                        </Badge>
                        <span className="text-muted-foreground">
                          {probe!.httpGet
                            ? `HTTP ${probe!.httpGet.path || '/'} :${probe!.httpGet.port}`
                            : probe!.tcpSocket
                              ? `TCP :${probe!.tcpSocket.port}`
                              : probe!.exec
                                ? `Exec: ${probe!.exec.command?.join(' ')}`
                                : 'Custom'}
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                          (initial: {probe!.initialDelaySeconds ?? 0}s, period:{' '}
                          {probe!.periodSeconds ?? 10}s)
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Image ID + Container ID */}
            {(status?.imageID || status?.containerID) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t">
                {status.imageID && (
                  <div>
                    <Label className={sectionLabelClassName}>Image ID</Label>
                    <p className="text-xs font-mono mt-1 text-muted-foreground break-all">
                      {status.imageID}
                    </p>
                  </div>
                )}
                {status.containerID && (
                  <div>
                    <Label className={sectionLabelClassName}>
                      Container ID
                    </Label>
                    <p className="text-xs font-mono mt-1 text-muted-foreground break-all">
                      {status.containerID}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
