import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { downloadKubeconfig } from '@/lib/api'
import { useCluster } from '@/hooks/use-cluster'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const presets = [
  { value: 86400, label: '1d' },
  { value: 604800, label: '7d' },
  { value: 2592000, label: '30d' },
  { value: 31536000, label: '1year' },
]
const minTTL = 3600
const maxTTL = 157680000
const pad = (value: number) => String(value).padStart(2, '0')
const dateParts = (date: Date) => ({
  year: String(date.getFullYear()),
  month: pad(date.getMonth() + 1),
  day: pad(date.getDate()),
  hour: pad(date.getHours()),
  minute: pad(date.getMinutes()),
  second: pad(date.getSeconds()),
})
type Expiration = ReturnType<typeof dateParts>
const toExpirationDate = (expiration: Expiration) =>
  new Date(
    Number(expiration.year),
    Number(expiration.month) - 1,
    Number(expiration.day),
    Number(expiration.hour),
    Number(expiration.minute),
    Number(expiration.second)
  )
const normalizeExpiration = (expiration: Expiration) => {
  const lastDay = new Date(
    Number(expiration.year),
    Number(expiration.month),
    0
  ).getDate()
  return Number(expiration.day) > lastDay
    ? { ...expiration, day: pad(lastDay) }
    : expiration
}

interface KubeconfigDownloadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KubeconfigDownloadDialog({
  open,
  onOpenChange,
}: KubeconfigDownloadDialogProps) {
  const { t } = useTranslation()
  const { clusters, currentCluster, refreshClusters } = useCluster()
  const [selected, setSelected] = useState<string[]>([])
  const [clusterSearch, setClusterSearch] = useState('')
  const [ttl, setTTL] = useState(2592000)
  const [custom, setCustom] = useState(false)
  const [expiration, setExpiration] = useState(() =>
    dateParts(new Date(Date.now() + ttl * 1000))
  )
  const [now, setNow] = useState(Date.now())
  const [downloading, setDownloading] = useState(false)

  const downloadableClusters = useMemo(
    () => clusters.filter((cluster) => cluster.enabled && cluster.uuid),
    [clusters]
  )
  const filteredClusters = useMemo(
    () =>
      downloadableClusters.filter((cluster) =>
        cluster.name.toLowerCase().includes(clusterSearch.trim().toLowerCase())
      ),
    [clusterSearch, downloadableClusters]
  )
  const hasClusterSearch = clusterSearch.trim() !== ''
  const actionClusters = hasClusterSearch
    ? filteredClusters
    : downloadableClusters
  const actionClusterUUIDs = actionClusters.map((cluster) => cluster.uuid)
  const allActionClustersSelected =
    actionClusterUUIDs.length > 0 &&
    actionClusterUUIDs.every((uuid) => selected.includes(uuid))

  useEffect(() => {
    if (!open) return
    void refreshClusters()
  }, [open, refreshClusters])

  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    const current = downloadableClusters.find(
      (cluster) => cluster.name === currentCluster
    )
    setSelected(current ? [current.uuid] : [])
    setClusterSearch('')
    setTTL(2592000)
    setCustom(false)
    setExpiration(dateParts(new Date(Date.now() + 2592000 * 1000)))
    return () => window.clearInterval(interval)
  }, [open, currentCluster, downloadableClusters])

  const expirationDate = useMemo(
    () => toExpirationDate(expiration),
    [expiration]
  )
  const customTTL = Math.ceil((expirationDate.getTime() - now) / 1000)
  const clampExpiration = (candidate: Expiration) => {
    const normalized = normalizeExpiration(candidate)
    const timestamp = toExpirationDate(normalized).getTime()
    const minimum = now + minTTL * 1000
    const maximum = now + maxTTL * 1000
    return dateParts(new Date(Math.min(Math.max(timestamp, minimum), maximum)))
  }
  const effectiveTTL = custom ? customTTL : ttl
  const ttlError =
    custom && (customTTL < minTTL || customTTL > maxTTL)
      ? t(
          'kubeconfigDownload.ttlError',
          'Select an expiration time between 1 hour and 5 years from now.'
        )
      : ''

  const toggleCluster = (uuid: string) => {
    setSelected((items) =>
      items.includes(uuid)
        ? items.filter((item) => item !== uuid)
        : [...items, uuid]
    )
  }

  const handleDownload = async () => {
    const downloadTTL = custom
      ? Math.ceil((toExpirationDate(expiration).getTime() - Date.now()) / 1000)
      : ttl
    if (downloadTTL < minTTL || downloadTTL > maxTTL || selected.length === 0) {
      return
    }
    setDownloading(true)
    try {
      const currentUUID = downloadableClusters.find(
        (cluster) => cluster.name === currentCluster
      )?.uuid
      const clusterUUIDs = currentUUID
        ? [
            ...selected.filter((uuid) => uuid === currentUUID),
            ...selected.filter((uuid) => uuid !== currentUUID),
          ]
        : selected
      const blob = await downloadKubeconfig({
        clusterUUIDs,
        ttlSeconds: downloadTTL,
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'kite-kubeconfig.yaml'
      anchor.click()
      URL.revokeObjectURL(url)
      toast.success(t('kubeconfigDownload.success', 'Kubeconfig downloaded'))
      onOpenChange(false)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('kubeconfigDownload.error', 'Failed to download kubeconfig')
      )
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t('kubeconfigDownload.title', 'Download Kubeconfig')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'kubeconfigDownload.description',
              'Choose accessible clusters and an expiration time.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label>{t('kubeconfigDownload.clusters', 'Clusters')}</Label>
                <span className="text-xs text-muted-foreground">
                  {t(
                    'kubeconfigDownload.selectedSummary',
                    '{{selected}} selected / {{total}} total',
                    {
                      selected: selected.length,
                      total: downloadableClusters.length,
                    }
                  )}
                </span>
              </div>
              <Button
                type="button"
                variant="link"
                size="sm"
                disabled={actionClusters.length === 0}
                onClick={() =>
                  setSelected((items) =>
                    allActionClustersSelected
                      ? items.filter(
                          (uuid) => !actionClusterUUIDs.includes(uuid)
                        )
                      : [
                          ...items,
                          ...actionClusterUUIDs.filter(
                            (uuid) => !items.includes(uuid)
                          ),
                        ]
                  )
                }
              >
                {allActionClustersSelected
                  ? t(
                      hasClusterSearch
                        ? 'kubeconfigDownload.deselectMatching'
                        : 'kubeconfigDownload.deselectAll',
                      hasClusterSearch ? 'Deselect matching' : 'Deselect all'
                    )
                  : t(
                      hasClusterSearch
                        ? 'kubeconfigDownload.selectMatching'
                        : 'kubeconfigDownload.selectAll',
                      hasClusterSearch ? 'Select matching' : 'Select all'
                    )}
              </Button>
            </div>
            <Input
              value={clusterSearch}
              onChange={(event) => setClusterSearch(event.target.value)}
              placeholder={t(
                'kubeconfigDownload.searchClusters',
                'Search clusters'
              )}
            />
            <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border p-3">
              {filteredClusters.map((cluster) => (
                <label
                  key={cluster.uuid}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={selected.includes(cluster.uuid)}
                    onCheckedChange={() => toggleCluster(cluster.uuid)}
                  />
                  <span>{cluster.name}</span>
                  {cluster.name === currentCluster && (
                    <span className="text-xs text-muted-foreground">
                      ({t('common.fields.current', 'Current')})
                    </span>
                  )}
                </label>
              ))}
              {filteredClusters.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t(
                    'kubeconfigDownload.noClustersFound',
                    'No matching clusters found.'
                  )}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('kubeconfigDownload.expiration', 'Expiration')}</Label>
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => (
                <Button
                  key={preset.value}
                  type="button"
                  data-testid={`kubeconfig-ttl-${preset.value}`}
                  size="sm"
                  variant={
                    !custom && ttl === preset.value ? 'default' : 'outline'
                  }
                  onClick={() => {
                    setCustom(false)
                    setTTL(preset.value)
                  }}
                >
                  {t(
                    `kubeconfigDownload.presets.${preset.label}`,
                    preset.label
                  )}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant={custom ? 'default' : 'outline'}
                onClick={() => {
                  setCustom(true)
                  setExpiration(dateParts(new Date(Date.now() + ttl * 1000)))
                }}
              >
                {t('kubeconfigDownload.custom', 'Custom')}
              </Button>
            </div>
            {custom && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(5.5rem,1fr)_repeat(5,minmax(0,1fr))]">
                {[
                  [
                    'year',
                    expiration.year,
                    Array.from({ length: 6 }, (_, index) =>
                      String(new Date().getFullYear() + index)
                    ),
                  ],
                  [
                    'month',
                    expiration.month,
                    Array.from({ length: 12 }, (_, index) => pad(index + 1)),
                  ],
                  [
                    'day',
                    expiration.day,
                    Array.from(
                      {
                        length: new Date(
                          Number(expiration.year),
                          Number(expiration.month),
                          0
                        ).getDate(),
                      },
                      (_, index) => pad(index + 1)
                    ),
                  ],
                  [
                    'hour',
                    expiration.hour,
                    Array.from({ length: 24 }, (_, index) => pad(index)),
                  ],
                  [
                    'minute',
                    expiration.minute,
                    Array.from({ length: 60 }, (_, index) => pad(index)),
                  ],
                  [
                    'second',
                    expiration.second,
                    Array.from({ length: 60 }, (_, index) => pad(index)),
                  ],
                ].map(([name, value, options]) => (
                  <div key={name as string} className="space-y-1">
                    <Label htmlFor={`kubeconfig-${name}`} className="text-xs">
                      {t(`kubeconfigDownload.${name}`, name as string)}
                    </Label>
                    <Select
                      value={value as string}
                      onValueChange={(nextValue) =>
                        setExpiration((current) => {
                          const next: Expiration = {
                            ...current,
                            [name as keyof Expiration]: nextValue,
                          }
                          return clampExpiration(next)
                        })
                      }
                    >
                      <SelectTrigger
                        id={`kubeconfig-${name}`}
                        className={
                          name === 'year'
                            ? 'w-full min-w-[5.5rem] shrink-0'
                            : 'w-full'
                        }
                      >
                        <SelectValue
                          className={
                            name === 'year' ? 'whitespace-nowrap' : undefined
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {(options as string[]).map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}
            {effectiveTTL !== null && (
              <p className="text-xs text-muted-foreground">
                {t('kubeconfigDownload.expiresAt', 'Expires {{date}}', {
                  date: new Date(
                    Date.now() + effectiveTTL * 1000
                  ).toLocaleString(),
                })}
              </p>
            )}
            {ttlError && <p className="text-sm text-destructive">{ttlError}</p>}
          </div>
          <p className="border-t pt-3 text-xs text-muted-foreground">
            {t(
              'kubeconfigDownload.securityNotice',
              'This file contains a sensitive Bearer token. Store it securely and set file permissions to 0600.'
            )}
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t('common.actions.cancel', 'Cancel')}
          </Button>
          <Button
            disabled={downloading || selected.length === 0 || !!ttlError}
            onClick={handleDownload}
          >
            <Download className="mr-2 h-4 w-4" />
            {downloading
              ? t('kubeconfigDownload.downloading', 'Downloading...')
              : t('kubeconfigDownload.download', 'Download')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
