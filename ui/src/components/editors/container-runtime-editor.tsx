import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

import { ContainerConfig } from './deployment-form'

interface ContainerRuntimeEditorProps {
  container: ContainerConfig
  onUpdate: (updates: Partial<ContainerConfig>) => void
}

function toLines(value?: string[]) {
  return value?.join('\n') || ''
}

function fromLines(value: string, normalize = false) {
  if (value === '') return undefined

  const lines = value.split('\n')
  if (!normalize) return lines

  const normalizedLines = lines.map((line) => line.trim()).filter(Boolean)

  return normalizedLines.length > 0 ? normalizedLines : undefined
}

export function ContainerRuntimeEditor({
  container,
  onUpdate,
}: ContainerRuntimeEditorProps) {
  const { t } = useTranslation()
  const fieldId = useId()
  const runtimeMode = container.runtimeMode
  const shellPath = container.shellPath
  const shellOption =
    shellPath === '/bin/sh' || shellPath === '/bin/bash' ? shellPath : 'custom'

  const updateLifecycleCommand = (
    hook: 'postStart' | 'preStop',
    value: string,
    normalize = false
  ) => {
    const command = fromLines(value, normalize)
    const lifecycle = { ...container.lifecycle }

    if (command) {
      lifecycle[hook] = { exec: { command } }
    } else {
      delete lifecycle[hook]
    }

    onUpdate({
      lifecycle:
        lifecycle.postStart || lifecycle.preStop ? lifecycle : undefined,
    })
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h4 className="text-base font-medium">
            {t('deployments.containerRuntime.title')}
          </h4>
          <p className="text-xs text-muted-foreground">
            {t('deployments.containerRuntime.description')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t(
              container.runtimeEnabled
                ? 'deployments.containerRuntime.enabled'
                : 'deployments.containerRuntime.disabled'
            )}
          </span>
          <Switch
            id={`${fieldId}-runtime-enabled`}
            checked={container.runtimeEnabled}
            aria-label={t('deployments.containerRuntime.title')}
            onCheckedChange={(runtimeEnabled) => onUpdate({ runtimeEnabled })}
          />
        </div>
      </div>

      {container.runtimeEnabled && (
        <>
          <Tabs
            value={runtimeMode}
            onValueChange={(runtimeMode) =>
              onUpdate({
                runtimeMode: runtimeMode as ContainerConfig['runtimeMode'],
              })
            }
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="command">
                {t('deployments.containerRuntime.commandMode')}
              </TabsTrigger>
              <TabsTrigger value="shell">
                {t('deployments.containerRuntime.shellMode')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="command" className="pt-2">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label>{t('deployments.containerRuntime.command')}</Label>
                  <Textarea
                    value={toLines(container.command)}
                    onChange={(event) =>
                      onUpdate({ command: fromLines(event.target.value) })
                    }
                    onBlur={(event) =>
                      onUpdate({ command: fromLines(event.target.value, true) })
                    }
                    placeholder={'/bin/sh\n-c'}
                    rows={3}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('deployments.containerRuntime.oneEntryPerLine')}
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>{t('deployments.containerRuntime.args')}</Label>
                  <Textarea
                    value={toLines(container.args)}
                    onChange={(event) =>
                      onUpdate({ args: fromLines(event.target.value) })
                    }
                    onBlur={(event) =>
                      onUpdate({ args: fromLines(event.target.value, true) })
                    }
                    placeholder={'--config\n/etc/app/config.yaml'}
                    rows={3}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('deployments.containerRuntime.oneEntryPerLine')}
                  </p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="shell" className="flex flex-col gap-4 pt-2">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`${fieldId}-shell`}>
                    {t('deployments.containerRuntime.shell')}
                  </Label>
                  <Select
                    value={shellOption}
                    onValueChange={(value) =>
                      onUpdate({ shellPath: value === 'custom' ? '' : value })
                    }
                  >
                    <SelectTrigger id={`${fieldId}-shell`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="/bin/sh">/bin/sh</SelectItem>
                        <SelectItem value="/bin/bash">/bin/bash</SelectItem>
                        <SelectItem value="custom">
                          {t('deployments.containerRuntime.customShell')}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                {shellOption === 'custom' && (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`${fieldId}-shell-path`}>
                      {t('deployments.containerRuntime.shellPath')}
                    </Label>
                    <Input
                      id={`${fieldId}-shell-path`}
                      value={shellPath}
                      onChange={(event) =>
                        onUpdate({ shellPath: event.target.value })
                      }
                      placeholder="/usr/local/bin/bash"
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={`${fieldId}-shell-script`}>
                  {t('deployments.containerRuntime.script')}
                </Label>
                <Textarea
                  id={`${fieldId}-shell-script`}
                  className="font-mono"
                  value={container.shellScript}
                  onChange={(event) =>
                    onUpdate({ shellScript: event.target.value })
                  }
                  placeholder={
                    'set -e\nif [ "$ENV" = "prod" ]; then\n  echo "production"\nfi'
                  }
                  rows={8}
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  {t('deployments.containerRuntime.scriptDescription')}
                </p>
              </div>
            </TabsContent>
          </Tabs>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>{t('deployments.containerRuntime.postStart')}</Label>
              <Textarea
                value={toLines(container.lifecycle?.postStart?.exec?.command)}
                onChange={(event) =>
                  updateLifecycleCommand('postStart', event.target.value)
                }
                onBlur={(event) =>
                  updateLifecycleCommand('postStart', event.target.value, true)
                }
                placeholder={'/bin/sh\n-c\necho started'}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                {t('deployments.containerRuntime.execOnly')}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t('deployments.containerRuntime.preStop')}</Label>
              <Textarea
                value={toLines(container.lifecycle?.preStop?.exec?.command)}
                onChange={(event) =>
                  updateLifecycleCommand('preStop', event.target.value)
                }
                onBlur={(event) =>
                  updateLifecycleCommand('preStop', event.target.value, true)
                }
                placeholder={'/bin/sh\n-c\necho stopping'}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                {t('deployments.containerRuntime.execOnly')}
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
