import { Probe } from 'kubernetes-types/core/v1'
import { CircleHelp, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { ContainerConfig } from './deployment-form'

type ProbeAction = 'http' | 'tcp' | 'exec'
type ProbeNumberField =
  | 'initialDelaySeconds'
  | 'periodSeconds'
  | 'timeoutSeconds'
  | 'successThreshold'
  | 'failureThreshold'

interface ContainerProbesEditorProps {
  container: ContainerConfig
  onUpdate: (updates: Partial<ContainerConfig>) => void
}

function getProbeAction(probe: Probe): ProbeAction {
  if (probe.tcpSocket) return 'tcp'
  if (probe.exec) return 'exec'
  return 'http'
}

function parsePort(value: string): number | '' {
  return value === '' ? '' : Number(value)
}

function parseCommand(value: string, normalize = false) {
  if (value === '') return []

  const lines = value.split('\n')
  return normalize ? lines.map((line) => line.trim()).filter(Boolean) : lines
}

function createProbe(defaultPort?: number): Probe {
  return {
    httpGet: {
      scheme: 'HTTP',
      path: '/',
      port: defaultPort || '',
    },
    initialDelaySeconds: 0,
    periodSeconds: 10,
    timeoutSeconds: 1,
    successThreshold: 1,
    failureThreshold: 3,
  }
}

export function ContainerProbesEditor({
  container,
  onUpdate,
}: ContainerProbesEditorProps) {
  const { t } = useTranslation()

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h4 className="text-base font-medium">
          {t('deployments.containerProbes.title')}
        </h4>
        <p className="text-xs text-muted-foreground">
          {t('deployments.containerProbes.description')}
        </p>
      </div>

      {(
        [
          ['livenessProbe', 'liveness'],
          ['readinessProbe', 'readiness'],
          ['startupProbe', 'startup'],
        ] as const
      ).map(([probeKey, labelKey]) => (
        <ProbeEditor
          key={probeKey}
          id={probeKey}
          label={t(`deployments.containerProbes.${labelKey}`)}
          probe={container[probeKey]}
          defaultPort={container.port}
          allowSuccessThreshold={probeKey === 'readinessProbe'}
          onChange={(probe) => onUpdate({ [probeKey]: probe })}
        />
      ))}
    </section>
  )
}

function ProbeEditor({
  id,
  label,
  probe,
  defaultPort,
  allowSuccessThreshold,
  onChange,
}: {
  id: string
  label: string
  probe?: Probe
  defaultPort?: number
  allowSuccessThreshold: boolean
  onChange: (probe?: Probe) => void
}) {
  const { t } = useTranslation()
  const action = probe ? getProbeAction(probe) : 'http'

  const changeAction = (nextAction: ProbeAction) => {
    if (!probe) return

    const common = { ...probe }
    delete common.httpGet
    delete common.tcpSocket
    delete common.exec
    delete common.grpc

    if (nextAction === 'http') {
      onChange({
        ...common,
        httpGet: { scheme: 'HTTP', path: '/', port: defaultPort || '' },
      })
    } else if (nextAction === 'tcp') {
      onChange({ ...common, tcpSocket: { port: defaultPort || '' } })
    } else {
      onChange({ ...common, exec: { command: [] } })
    }
  }

  const updateNumber = (field: ProbeNumberField, value: string) => {
    if (!probe) return
    onChange({ ...probe, [field]: value === '' ? undefined : Number(value) })
  }

  const updateHeader = (
    index: number,
    field: 'name' | 'value',
    value: string
  ) => {
    if (!probe?.httpGet) return
    const headers = [...(probe.httpGet.httpHeaders || [])]
    headers[index] = { ...headers[index], [field]: value }
    onChange({
      ...probe,
      httpGet: { ...probe.httpGet, httpHeaders: headers },
    })
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {probe
              ? t('deployments.containerProbes.enabled')
              : t('deployments.containerProbes.disabled')}
          </span>
          <Switch
            id={id}
            checked={!!probe}
            onCheckedChange={(checked) =>
              onChange(checked ? createProbe(defaultPort) : undefined)
            }
          />
        </div>
      </div>

      {probe && (
        <>
          <Tabs
            value={action}
            onValueChange={(value) => changeAction(value as ProbeAction)}
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="http">
                {t('deployments.containerProbes.http')}
              </TabsTrigger>
              <TabsTrigger value="tcp">
                {t('deployments.containerProbes.tcp')}
              </TabsTrigger>
              <TabsTrigger value="exec">
                {t('deployments.containerProbes.exec')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="http" className="flex flex-col gap-4 pt-2">
              {probe.httpGet && (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="flex flex-col gap-2">
                      <Label>{t('deployments.containerProbes.scheme')}</Label>
                      <Select
                        value={probe.httpGet.scheme || 'HTTP'}
                        onValueChange={(scheme) =>
                          onChange({
                            ...probe,
                            httpGet: { ...probe.httpGet!, scheme },
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="HTTP">HTTP</SelectItem>
                          <SelectItem value="HTTPS">HTTPS</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-2 sm:col-span-2">
                      <Label>{t('deployments.containerProbes.path')}</Label>
                      <Input
                        value={probe.httpGet.path || ''}
                        onChange={(event) =>
                          onChange({
                            ...probe,
                            httpGet: {
                              ...probe.httpGet!,
                              path: event.target.value,
                            },
                          })
                        }
                        placeholder="/healthz"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label>{t('deployments.containerProbes.port')}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={65535}
                      value={probe.httpGet.port}
                      onChange={(event) =>
                        onChange({
                          ...probe,
                          httpGet: {
                            ...probe.httpGet!,
                            port: parsePort(event.target.value),
                          },
                        })
                      }
                      placeholder="8080"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label>{t('deployments.containerProbes.headers')}</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          onChange({
                            ...probe,
                            httpGet: {
                              ...probe.httpGet!,
                              httpHeaders: [
                                ...(probe.httpGet?.httpHeaders || []),
                                { name: '', value: '' },
                              ],
                            },
                          })
                        }
                      >
                        <Plus data-icon="inline-start" />
                        {t('deployments.containerProbes.addHeader')}
                      </Button>
                    </div>
                    {probe.httpGet.httpHeaders?.map((header, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input
                          value={header.name}
                          onChange={(event) =>
                            updateHeader(index, 'name', event.target.value)
                          }
                          placeholder={t(
                            'deployments.containerProbes.headerName'
                          )}
                        />
                        <Input
                          value={header.value}
                          onChange={(event) =>
                            updateHeader(index, 'value', event.target.value)
                          }
                          placeholder={t(
                            'deployments.containerProbes.headerValue'
                          )}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t(
                            'deployments.containerProbes.removeHeader'
                          )}
                          onClick={() => {
                            const headers =
                              probe.httpGet?.httpHeaders?.filter(
                                (_, headerIndex) => headerIndex !== index
                              ) || []
                            onChange({
                              ...probe,
                              httpGet: {
                                ...probe.httpGet!,
                                httpHeaders:
                                  headers.length > 0 ? headers : undefined,
                              },
                            })
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="tcp" className="pt-2">
              {probe.tcpSocket && (
                <div className="flex flex-col gap-2">
                  <Label>{t('deployments.containerProbes.port')}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={65535}
                    value={probe.tcpSocket.port}
                    onChange={(event) =>
                      onChange({
                        ...probe,
                        tcpSocket: {
                          ...probe.tcpSocket!,
                          port: parsePort(event.target.value),
                        },
                      })
                    }
                    placeholder="8080"
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="exec" className="pt-2">
              {probe.exec && (
                <div className="flex flex-col gap-2">
                  <Label>{t('deployments.containerProbes.command')}</Label>
                  <Textarea
                    value={probe.exec.command?.join('\n') || ''}
                    onChange={(event) =>
                      onChange({
                        ...probe,
                        exec: { command: parseCommand(event.target.value) },
                      })
                    }
                    onBlur={(event) =>
                      onChange({
                        ...probe,
                        exec: {
                          command: parseCommand(event.target.value, true),
                        },
                      })
                    }
                    placeholder={'/bin/sh\n-c\ncurl -f http://localhost/health'}
                    rows={3}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('deployments.containerRuntime.oneEntryPerLine')}
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <NumberField
              label={t('deployments.containerProbes.initialDelay')}
              value={probe.initialDelaySeconds}
              min={0}
              onChange={(value) => updateNumber('initialDelaySeconds', value)}
            />
            <NumberField
              label={t('deployments.containerProbes.period')}
              value={probe.periodSeconds}
              onChange={(value) => updateNumber('periodSeconds', value)}
            />
            <NumberField
              label={t('deployments.containerProbes.timeout')}
              value={probe.timeoutSeconds}
              onChange={(value) => updateNumber('timeoutSeconds', value)}
            />
            <NumberField
              label={t('deployments.containerProbes.successThreshold')}
              value={allowSuccessThreshold ? probe.successThreshold : 1}
              disabled={!allowSuccessThreshold}
              help={
                allowSuccessThreshold
                  ? undefined
                  : t('deployments.containerProbes.successThresholdFixed')
              }
              onChange={(value) => updateNumber('successThreshold', value)}
            />
            <NumberField
              label={t('deployments.containerProbes.failureThreshold')}
              value={probe.failureThreshold}
              onChange={(value) => updateNumber('failureThreshold', value)}
            />
          </div>
        </>
      )}
    </div>
  )
}

function NumberField({
  label,
  value,
  min = 1,
  disabled = false,
  help,
  onChange,
}: {
  label: string
  value?: number
  min?: number
  disabled?: boolean
  help?: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="min-h-8 items-end leading-4">
        {label}
        {help && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="shrink-0 text-muted-foreground"
                aria-label={help}
              >
                <CircleHelp className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{help}</TooltipContent>
          </Tooltip>
        )}
      </Label>
      <Input
        type="number"
        min={min}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
