import { useState } from 'react'
import { Container } from 'kubernetes-types/core/v1'
import { ChevronDown, ChevronRight, Edit3 } from 'lucide-react'

import { ContainerEditDialog } from './container-edit-dialog'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Label } from './ui/label'

export function ContainerTable(props: {
  container: Container
  onContainerUpdate?: (updatedContainer: Container) => void
  init?: boolean
}) {
  const { container, onContainerUpdate, init } = props
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  const handleContainerUpdate = (updatedContainer: Container) => {
    onContainerUpdate?.(updatedContainer)
  }

  return (
    <>
      <div className="border rounded-lg overflow-hidden">
        {/* Container Header */}
        <div
          className={`${isExpanded ? 'border-b' : ''} bg-muted/30 p-4 cursor-pointer hover:bg-muted/50 transition-colors`}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <Badge variant="default" className="font-medium">
                  {container.name}
                </Badge>
              </div>
              <span className="text-sm text-muted-foreground font-mono">
                {container.image}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {init && container.restartPolicy === 'Always' && (
                <Badge variant="secondary" className="text-xs">
                  Sidecar
                </Badge>
              )}
              {container.imagePullPolicy && (
                <Badge variant="outline" className="text-xs font-mono">
                  {container.imagePullPolicy}
                </Badge>
              )}
              {onContainerUpdate && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditDialogOpen(true)
                  }}
                  className="h-8 w-8 p-0"
                >
                  <Edit3 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Container Details */}
        {isExpanded && (
          <div className="p-4 space-y-4">
            {/* Basic Info - Always show in a consistent layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Ports */}
              <div>
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Ports
                </Label>
                <div className="mt-1 min-h-[24px]">
                  {container.ports && container.ports.length > 0 ? (
                    <div className="space-y-1">
                      {container.ports.map((port, portIndex) => (
                        <div
                          key={portIndex}
                          className="flex items-center gap-2 text-sm"
                        >
                          <Badge variant="secondary" className="text-xs">
                            {port.containerPort}
                          </Badge>
                          {port.protocol && (
                            <span className="text-muted-foreground">
                              {port.protocol}
                            </span>
                          )}
                          {port.name && (
                            <span className="text-muted-foreground">
                              ({port.name})
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      No ports exposed
                    </div>
                  )}
                </div>
              </div>

              {/* Resources */}
              <div>
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Resources
                </Label>
                <div className="mt-1 min-h-[24px]">
                  {container.resources &&
                  (container.resources.requests ||
                    container.resources.limits) ? (
                    <div className="space-y-2">
                      {container.resources.requests && (
                        <div>
                          <div className="text-xs font-medium text-green-600 dark:text-green-400">
                            Requests
                          </div>
                          <div className="text-sm space-y-1">
                            {container.resources.requests.cpu && (
                              <div className="flex gap-2">
                                <span className="text-muted-foreground">
                                  CPU:
                                </span>
                                <span>{container.resources.requests.cpu}</span>
                              </div>
                            )}
                            {container.resources.requests.memory && (
                              <div className="flex gap-2">
                                <span className="text-muted-foreground">
                                  Memory:
                                </span>
                                <span>
                                  {container.resources.requests.memory}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {container.resources.limits && (
                        <div>
                          <div className="text-xs font-medium text-red-600 dark:text-red-400">
                            Limits
                          </div>
                          <div className="text-sm space-y-1">
                            {container.resources.limits.cpu && (
                              <div className="flex gap-2">
                                <span className="text-muted-foreground">
                                  CPU:
                                </span>
                                <span>{container.resources.limits.cpu}</span>
                              </div>
                            )}
                            {container.resources.limits.memory && (
                              <div className="flex gap-2">
                                <span className="text-muted-foreground">
                                  Memory:
                                </span>
                                <span>{container.resources.limits.memory}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      No resource configured
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Environment Variables - Full width when present */}
            {((container.env && container.env.length > 0) ||
              (container.envFrom && container.envFrom.length > 0)) && (
              <div className="border-t pt-3">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Environment Variables
                  {container.env &&
                    container.env.length > 0 &&
                    ` (${container.env.length})`}
                </Label>
                <div className="mt-2 space-y-3">
                  {/* Direct environment variables */}
                  {container.env && container.env.length > 0 && (
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {container.env.slice(0, 5).map((envVar, envIndex) => (
                        <div key={envIndex} className="text-sm">
                          <div className=" text-xs">
                            <span className="text-blue-600 dark:text-blue-400 font-mono">
                              {envVar.name}
                            </span>
                            {envVar.value && (
                              <>
                                <span className="text-muted-foreground">=</span>
                                <span className="text-muted-foreground truncate font-mono">
                                  {envVar.value}
                                </span>
                              </>
                            )}
                            {envVar.valueFrom && (
                              <span className="text-orange-600 dark:text-orange-400 ml-1">
                                (from{' '}
                                {envVar.valueFrom.secretKeyRef
                                  ? 'secret'
                                  : envVar.valueFrom.configMapKeyRef
                                    ? 'configmap'
                                    : envVar.valueFrom.fieldRef
                                      ? 'field'
                                      : 'ref'}
                                )
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                      {container.env.length > 5 && (
                        <div className="text-xs text-muted-foreground">
                          ... and {container.env.length - 5} more
                        </div>
                      )}
                    </div>
                  )}

                  {/* Environment variables from sources */}
                  {container.envFrom && container.envFrom.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-purple-600 dark:text-purple-400 mb-2">
                        Environment From Sources ({container.envFrom.length})
                      </div>
                      <div className="space-y-1">
                        {container.envFrom.map(
                          (envFromSource, envFromIndex) => (
                            <div key={envFromIndex} className="text-sm">
                              <div className="flex items-center gap-2">
                                {envFromSource.configMapRef && (
                                  <>
                                    <Badge
                                      variant="outline"
                                      className="text-xs bg-blue-50 dark:bg-blue-950"
                                    >
                                      ConfigMap
                                    </Badge>
                                    <span className=" text-xs text-blue-600 dark:text-blue-400">
                                      {envFromSource.configMapRef.name}
                                    </span>
                                    {envFromSource.configMapRef.optional && (
                                      <Badge
                                        variant="secondary"
                                        className="text-xs"
                                      >
                                        Optional
                                      </Badge>
                                    )}
                                  </>
                                )}
                                {envFromSource.secretRef && (
                                  <>
                                    <Badge
                                      variant="outline"
                                      className="text-xs bg-green-50 dark:bg-green-950"
                                    >
                                      Secret
                                    </Badge>
                                    <span className=" text-xs text-green-600 dark:text-green-400">
                                      {envFromSource.secretRef.name}
                                    </span>
                                    {envFromSource.secretRef.optional && (
                                      <Badge
                                        variant="secondary"
                                        className="text-xs"
                                      >
                                        Optional
                                      </Badge>
                                    )}
                                  </>
                                )}
                                {envFromSource.prefix && (
                                  <span className="text-xs text-muted-foreground">
                                    (prefix: {envFromSource.prefix})
                                  </span>
                                )}
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Additional Info - Always show with consistent layout */}
            <div className="border-t pt-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Volume Mounts */}
                <div>
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Volume Mounts
                  </Label>
                  <div className="mt-1 min-h-[24px]">
                    {container.volumeMounts &&
                    container.volumeMounts.length > 0 ? (
                      <div className="space-y-1">
                        {container.volumeMounts
                          .slice(0, 3)
                          .map((mount, mountIndex) => (
                            <div key={mountIndex} className="text-sm">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs">
                                  {mount.name}
                                </Badge>
                                <span className="text-muted-foreground  text-xs font-mono">
                                  {mount.mountPath}
                                </span>
                                {mount.readOnly && (
                                  <Badge
                                    variant="secondary"
                                    className="text-xs"
                                  >
                                    RO
                                  </Badge>
                                )}
                              </div>
                            </div>
                          ))}
                        {container.volumeMounts.length > 3 && (
                          <div className="text-xs text-muted-foreground">
                            ... and {container.volumeMounts.length - 3} more
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        No volume mounts
                      </div>
                    )}
                  </div>
                </div>

                {/* Probes */}
                <div>
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Health Checks
                  </Label>
                  <div className="mt-1 min-h-[24px]">
                    {container.livenessProbe ||
                    container.readinessProbe ||
                    container.startupProbe ? (
                      <div className="space-y-1">
                        {container.livenessProbe && (
                          <div className="flex items-center gap-2 text-sm">
                            <Badge
                              variant="outline"
                              className="text-xs bg-green-50 dark:bg-green-950"
                            >
                              Liveness
                            </Badge>
                            <span className="text-muted-foreground text-xs">
                              {container.livenessProbe.httpGet
                                ? 'HTTP'
                                : container.livenessProbe.tcpSocket
                                  ? 'TCP'
                                  : container.livenessProbe.exec
                                    ? 'Exec'
                                    : 'Custom'}
                            </span>
                          </div>
                        )}
                        {container.readinessProbe && (
                          <div className="flex items-center gap-2 text-sm">
                            <Badge
                              variant="outline"
                              className="text-xs bg-blue-50 dark:bg-blue-950"
                            >
                              Readiness
                            </Badge>
                            <span className="text-muted-foreground text-xs">
                              {container.readinessProbe.httpGet
                                ? 'HTTP'
                                : container.readinessProbe.tcpSocket
                                  ? 'TCP'
                                  : container.readinessProbe.exec
                                    ? 'Exec'
                                    : 'Custom'}
                            </span>
                          </div>
                        )}
                        {container.startupProbe && (
                          <div className="flex items-center gap-2 text-sm">
                            <Badge
                              variant="outline"
                              className="text-xs bg-yellow-50 dark:bg-yellow-950"
                            >
                              Startup
                            </Badge>
                            <span className="text-muted-foreground text-xs">
                              {container.startupProbe.httpGet
                                ? 'HTTP'
                                : container.startupProbe.tcpSocket
                                  ? 'TCP'
                                  : container.startupProbe.exec
                                    ? 'Exec'
                                    : 'Custom'}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        No health checks configured
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <ContainerEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        container={container}
        onSave={handleContainerUpdate}
      />
    </>
  )
}
