import { useEffect, useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type { HelmRelease, HelmReleaseAutoUpgradeRequest } from '@/types/api'
import {
  updateHelmReleaseAutoUpgrade,
  useHelmReleaseAutoUpgrade,
} from '@/lib/api'
import { formatDate, translateError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { useHelmReleaseChartSelection } from './helmrelease-chart-selection'
import { HelmReleaseChartSelector } from './helmrelease-chart-selector'

export function HelmReleaseAutoUpgradeDialog({
  release,
  open,
  onOpenChange,
  onSaved,
}: {
  release: HelmRelease
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const chartName = release.spec?.chartName || release.spec?.chart || ''
  const currentVersion = release.spec?.chartVersion || ''
  const [enabled, setEnabled] = useState(false)
  const [scheduleType, setScheduleType] = useState<'interval' | 'daily'>(
    'interval'
  )
  const [intervalMinutes, setIntervalMinutes] = useState('60')
  const [scheduleTime, setScheduleTime] = useState('03:00')
  const [timeoutMinutes, setTimeoutMinutes] = useState('5')
  const [rollbackOnFailure, setRollbackOnFailure] = useState(true)
  const [selectedRepository, setSelectedRepository] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const configQuery = useHelmReleaseAutoUpgrade(
    release.metadata.namespace,
    release.metadata.name,
    { enabled: open }
  )
  const chartSelection = useHelmReleaseChartSelection({
    chartName,
    currentVersion,
    open: open && !!chartName,
    selectedRepository,
  })
  const activeChart = chartSelection.activeChart
  const isChartSourceLoading = chartSelection.isChartSourceLoading
  const intervalValue = Number(intervalMinutes)
  const timeoutValue = Number(timeoutMinutes)
  const isScheduleTimeValid = /^\d{2}:\d{2}$/.test(scheduleTime)
  const canSave =
    !isSaving &&
    !configQuery.isLoading &&
    (!enabled ||
      ((scheduleType === 'daily' ||
        (Number.isFinite(intervalValue) && intervalValue >= 1)) &&
        (scheduleType === 'interval' || isScheduleTimeValid) &&
        Number.isFinite(timeoutValue) &&
        timeoutValue >= 1 &&
        !!activeChart &&
        !isChartSourceLoading))

  useEffect(() => {
    if (!open || !configQuery.data) {
      return
    }
    setEnabled(configQuery.data.enabled)
    setScheduleType(configQuery.data.scheduleType)
    setIntervalMinutes(String(configQuery.data.intervalMinutes || 60))
    setScheduleTime(configQuery.data.scheduleTime || '03:00')
    setTimeoutMinutes(String(configQuery.data.timeoutMinutes))
    setRollbackOnFailure(configQuery.data.rollbackOnFailure)
    setSelectedRepository(
      configQuery.data.repositoryName
        ? `${configQuery.data.source || 'repository'}:${configQuery.data.repositoryName}`
        : ''
    )
    setError('')
  }, [configQuery.data, open])

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (
      enabled &&
      scheduleType === 'interval' &&
      (!Number.isFinite(intervalValue) || intervalValue < 1)
    ) {
      setError(t('helm.messages.invalidAutoUpgradeInterval'))
      return
    }
    if (enabled && scheduleType === 'daily' && !isScheduleTimeValid) {
      setError(t('helm.messages.invalidAutoUpgradeScheduleTime'))
      return
    }
    if (enabled && (!Number.isFinite(timeoutValue) || timeoutValue < 1)) {
      setError(t('helm.messages.invalidAutoUpgradeTimeout'))
      return
    }
    if (enabled && !activeChart) {
      setError(t('helm.messages.autoUpgradeChartRequired'))
      return
    }

    const body: HelmReleaseAutoUpgradeRequest = {
      enabled,
      scheduleType,
      intervalMinutes: Number.isFinite(intervalValue) ? intervalValue : 60,
      scheduleTime,
      timeoutMinutes: Number.isFinite(timeoutValue) ? timeoutValue : 5,
      rollbackOnFailure,
      ...(activeChart
        ? {
            source: activeChart.source || 'repository',
            repositoryName: activeChart.repositoryName,
            chartName: activeChart.name,
          }
        : {}),
    }
    setIsSaving(true)
    try {
      await updateHelmReleaseAutoUpgrade(
        release.metadata.namespace,
        release.metadata.name,
        body
      )
      toast.success(t('helm.messages.autoUpgradeSaved'))
      await configQuery.refetch()
      await onSaved?.()
      onOpenChange(false)
    } catch (err) {
      setError(translateError(err, t))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:!max-w-4xl">
        <form
          onSubmit={handleSave}
          className="flex max-h-[calc(100dvh-2rem)] flex-col"
        >
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle className="text-balance">
              {t('helm.actions.autoUpgrade')}
            </DialogTitle>
            <DialogDescription className="truncate">
              {release.metadata.namespace}/{release.metadata.name}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6">
            {error ? (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {error}
              </div>
            ) : null}

            <section className="rounded-lg border p-4">
              <div className="grid items-center gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
                <Label
                  htmlFor="helm-auto-upgrade-enabled"
                  className="text-base font-semibold"
                >
                  {t('helm.fields.autoUpgrade')}
                </Label>
                <p className="text-pretty text-sm text-muted-foreground">
                  {t('helm.messages.autoUpgradeDescription')}
                </p>
                <Switch
                  id="helm-auto-upgrade-enabled"
                  checked={enabled}
                  onCheckedChange={(value) => setEnabled(value)}
                  disabled={isSaving || configQuery.isLoading}
                />
              </div>
            </section>

            <section className="rounded-lg border p-4">
              <div className="grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
                <div className="space-y-2">
                  <h3 className="text-balance text-base font-semibold">
                    {t('helm.fields.chart')}
                  </h3>
                  <p className="text-pretty text-sm text-muted-foreground">
                    {t('helm.messages.autoUpgradeChartDescription')}
                  </p>
                </div>

                <HelmReleaseChartSelector
                  selection={chartSelection}
                  label={t('helm.fields.chartRepository')}
                  disabled={!enabled || isSaving || configQuery.isLoading}
                  onSelectedRepositoryChange={setSelectedRepository}
                />
              </div>
            </section>

            <section className="rounded-lg border p-4">
              <div className="grid gap-5 lg:grid-cols-[12rem_minmax(0,1fr)]">
                <h3 className="text-balance text-base font-semibold">
                  {t('helm.fields.upgradeSettings')}
                </h3>

                <div className="space-y-5">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-start">
                    <div className="space-y-1.5">
                      <Label>{t('helm.fields.schedule')}</Label>
                      <p className="text-pretty text-sm text-muted-foreground">
                        {t('helm.messages.autoUpgradeScheduleDescription')}
                      </p>
                    </div>
                    <Tabs
                      value={scheduleType}
                      onValueChange={(value) =>
                        setScheduleType(value as 'interval' | 'daily')
                      }
                      className="w-full"
                    >
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger
                          value="interval"
                          disabled={
                            !enabled || isSaving || configQuery.isLoading
                          }
                        >
                          {t('helm.fields.scheduleInterval')}
                        </TabsTrigger>
                        <TabsTrigger
                          value="daily"
                          disabled={
                            !enabled || isSaving || configQuery.isLoading
                          }
                        >
                          {t('helm.fields.scheduleDaily')}
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      {scheduleType === 'interval' ? (
                        <>
                          <Label htmlFor="helm-auto-upgrade-interval">
                            {t('helm.fields.intervalMinutes')}
                          </Label>
                          <p className="text-pretty text-sm text-muted-foreground">
                            {t('helm.messages.autoUpgradeIntervalDescription')}
                          </p>
                          <Input
                            id="helm-auto-upgrade-interval"
                            type="number"
                            min={1}
                            value={intervalMinutes}
                            onChange={(event) =>
                              setIntervalMinutes(event.target.value)
                            }
                            disabled={
                              !enabled || isSaving || configQuery.isLoading
                            }
                          />
                        </>
                      ) : (
                        <>
                          <Label htmlFor="helm-auto-upgrade-schedule-time">
                            {t('helm.fields.scheduleTime')}
                          </Label>
                          <p className="text-pretty text-sm text-muted-foreground">
                            {t(
                              'helm.messages.autoUpgradeScheduleTimeDescription'
                            )}
                          </p>
                          <Input
                            id="helm-auto-upgrade-schedule-time"
                            type="time"
                            value={scheduleTime}
                            onChange={(event) =>
                              setScheduleTime(event.target.value)
                            }
                            disabled={
                              !enabled || isSaving || configQuery.isLoading
                            }
                          />
                        </>
                      )}
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="helm-auto-upgrade-timeout">
                        {t('helm.fields.timeoutMinutes')}
                      </Label>
                      <p className="text-pretty text-sm text-muted-foreground">
                        {t('helm.messages.autoUpgradeTimeoutDescription')}
                      </p>
                      <Input
                        id="helm-auto-upgrade-timeout"
                        type="number"
                        min={1}
                        value={timeoutMinutes}
                        onChange={(event) =>
                          setTimeoutMinutes(event.target.value)
                        }
                        disabled={!enabled || isSaving || configQuery.isLoading}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1.5">
                      <Label htmlFor="helm-auto-upgrade-rollback-on-failure">
                        {t('helm.fields.rollbackOnFailure')}
                      </Label>
                    </div>
                    <Switch
                      id="helm-auto-upgrade-rollback-on-failure"
                      checked={rollbackOnFailure}
                      onCheckedChange={(value) => setRollbackOnFailure(value)}
                      disabled={!enabled || isSaving || configQuery.isLoading}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-lg border p-4">
              <h3 className="mb-4 text-balance text-sm font-semibold">
                {t('helm.fields.status')}
              </h3>
              <div className="grid gap-4 text-sm md:grid-cols-3">
                <div className="min-w-0">
                  <div className="text-muted-foreground">
                    {t('helm.fields.lastChecked')}
                  </div>
                  <div className="truncate font-medium tabular-nums">
                    {configQuery.data?.lastCheckedAt
                      ? formatDate(configQuery.data.lastCheckedAt)
                      : '-'}
                  </div>
                </div>

                <div className="min-w-0 md:border-l md:pl-4">
                  <div className="text-muted-foreground">
                    {t('helm.fields.lastUpgraded')}
                  </div>
                  <div className="truncate font-medium tabular-nums">
                    {configQuery.data?.lastUpgradedAt
                      ? formatDate(configQuery.data.lastUpgradedAt)
                      : '-'}
                  </div>
                </div>

                <div className="min-w-0 md:border-l md:pl-4">
                  <div className="text-muted-foreground">
                    {t('helm.fields.lastError')}
                  </div>
                  <div className="truncate font-medium">
                    {configQuery.data?.lastError || '-'}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <DialogFooter className="border-t bg-muted/20 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('common.actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
