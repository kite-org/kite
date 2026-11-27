import { Toleration } from 'kubernetes-types/core/v1'
import { Plus, Trash2 } from 'lucide-react'
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
import { Separator } from '@/components/ui/separator'

import { DeploymentFormData } from './deployment-form'
import { KeyValueEditor } from './key-value-editor'

interface DeploymentSchedulingEditorProps {
  formData: DeploymentFormData
  onUpdate: (updates: Partial<DeploymentFormData>) => void
}

type RollingField = 'maxUnavailable' | 'maxSurge'
type RollingUnit = 'pods' | 'percent'

export function DeploymentSchedulingEditor({
  formData,
  onUpdate,
}: DeploymentSchedulingEditorProps) {
  const { t } = useTranslation()

  const updateRollingValue = (
    field: RollingField,
    updates: { value?: number | ''; unit?: RollingUnit }
  ) => {
    onUpdate({
      strategy: {
        ...formData.strategy,
        [field]: { ...formData.strategy[field], ...updates },
      },
    })
  }

  const updateToleration = (index: number, updates: Partial<Toleration>) => {
    const tolerations = formData.podSpec.tolerations.map(
      (toleration, tolerationIndex) => {
        if (tolerationIndex !== index) return toleration

        const updated = { ...toleration, ...updates }
        if (updated.operator === 'Exists') updated.value = ''
        if (updated.effect !== 'NoExecute') {
          delete updated.tolerationSeconds
        }
        return updated
      }
    )
    onUpdate({ podSpec: { ...formData.podSpec, tolerations } })
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h4 className="text-base font-medium">
            {t('deployments.podConfiguration.updateStrategy')}
          </h4>
          <p className="text-xs text-muted-foreground">
            {t('deployments.podConfiguration.updateStrategyDescription')}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label>{t('deployments.podConfiguration.strategy')}</Label>
            <Select
              value={formData.strategy.type}
              onValueChange={(type: 'RollingUpdate' | 'Recreate') =>
                onUpdate({ strategy: { ...formData.strategy, type } })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="RollingUpdate">RollingUpdate</SelectItem>
                <SelectItem value="Recreate">Recreate</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t('deployments.podConfiguration.minReadySeconds')}</Label>
            <Input
              type="number"
              min={0}
              value={formData.minReadySeconds}
              onChange={(event) =>
                onUpdate({ minReadySeconds: Number(event.target.value) })
              }
            />
          </div>
        </div>

        {formData.strategy.type === 'RollingUpdate' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(['maxUnavailable', 'maxSurge'] as const).map((field) => {
              const rollingValue = formData.strategy[field]
              return (
                <div key={field} className="flex flex-col gap-2">
                  <Label>{t(`deployments.podConfiguration.${field}`)}</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={rollingValue.unit === 'percent' ? 100 : undefined}
                      value={rollingValue.value}
                      onChange={(event) =>
                        updateRollingValue(field, {
                          value:
                            event.target.value === ''
                              ? ''
                              : Number(event.target.value),
                        })
                      }
                    />
                    <Select
                      value={rollingValue.unit}
                      onValueChange={(nextUnit: RollingUnit) =>
                        updateRollingValue(field, { unit: nextUnit })
                      }
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percent">%</SelectItem>
                        <SelectItem value="pods">
                          {t('deployments.podConfiguration.pods')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <Separator />

      <KeyValueEditor
        title={t('deployments.podConfiguration.nodeSelector')}
        addLabel={t('deployments.podConfiguration.addNodeSelector')}
        entries={formData.podSpec.nodeSelector}
        onChange={(nodeSelector) =>
          onUpdate({ podSpec: { ...formData.podSpec, nodeSelector } })
        }
      />

      <Separator />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h4 className="text-base font-medium">
              {t('deployments.podConfiguration.tolerations')}
            </h4>
            <p className="text-xs text-muted-foreground">
              {t('deployments.podConfiguration.tolerationsDescription')}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onUpdate({
                podSpec: {
                  ...formData.podSpec,
                  tolerations: [
                    ...formData.podSpec.tolerations,
                    { key: '', operator: 'Equal', effect: 'NoSchedule' },
                  ],
                },
              })
            }
          >
            <Plus data-icon="inline-start" />
            {t('deployments.podConfiguration.addToleration')}
          </Button>
        </div>

        {formData.podSpec.tolerations.map((toleration, index) => (
          <div
            key={index}
            className="flex flex-col gap-3 rounded-md border p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <Label>
                {t('deployments.podConfiguration.toleration', {
                  index: index + 1,
                })}
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('deployments.podConfiguration.removeToleration', {
                  index: index + 1,
                })}
                onClick={() =>
                  onUpdate({
                    podSpec: {
                      ...formData.podSpec,
                      tolerations: formData.podSpec.tolerations.filter(
                        (_, tolerationIndex) => tolerationIndex !== index
                      ),
                    },
                  })
                }
              >
                <Trash2 />
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-2">
                <Label>{t('deployments.podConfiguration.key')}</Label>
                <Input
                  value={toleration.key || ''}
                  onChange={(event) =>
                    updateToleration(index, { key: event.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t('deployments.podConfiguration.operator')}</Label>
                <Select
                  value={toleration.operator || 'Equal'}
                  onValueChange={(operator) =>
                    updateToleration(index, { operator })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Equal">Equal</SelectItem>
                    <SelectItem value="Exists">Exists</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t('deployments.podConfiguration.value')}</Label>
                <Input
                  value={toleration.value || ''}
                  disabled={toleration.operator === 'Exists'}
                  onChange={(event) =>
                    updateToleration(index, { value: event.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t('deployments.podConfiguration.effect')}</Label>
                <Select
                  value={toleration.effect || 'any'}
                  onValueChange={(effect) =>
                    updateToleration(index, {
                      effect: effect === 'any' ? undefined : effect,
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">
                      {t('deployments.podConfiguration.anyEffect')}
                    </SelectItem>
                    <SelectItem value="NoSchedule">NoSchedule</SelectItem>
                    <SelectItem value="PreferNoSchedule">
                      PreferNoSchedule
                    </SelectItem>
                    <SelectItem value="NoExecute">NoExecute</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {toleration.effect === 'NoExecute' && (
              <div className="flex max-w-xs flex-col gap-2">
                <Label>
                  {t('deployments.podConfiguration.tolerationSeconds')}
                </Label>
                <Input
                  type="number"
                  min={0}
                  value={toleration.tolerationSeconds ?? ''}
                  placeholder={t(
                    'deployments.podConfiguration.tolerationSecondsPlaceholder'
                  )}
                  onChange={(event) =>
                    updateToleration(index, {
                      tolerationSeconds:
                        event.target.value === ''
                          ? undefined
                          : Number(event.target.value),
                    })
                  }
                />
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  )
}
