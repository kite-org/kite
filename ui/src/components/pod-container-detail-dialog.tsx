import { useEffect, useState } from 'react'
import { Container } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ContainerInfoCard } from '@/components/container-info-card'

import type { PodOverviewContainer } from './pod-overview-types'

export function ContainerDetailDialog({
  item,
  open,
  onOpenChange,
}: {
  item: PodOverviewContainer | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('details')

  useEffect(() => {
    if (open) {
      setTab('details')
    }
  }, [open, item?.container.name])

  if (!item) {
    return null
  }

  const { container, init, status } = item
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] !max-w-5xl flex-col overflow-hidden sm:!max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-2">
            <Badge
              variant="outline"
              className="max-w-full truncate border-primary/20 bg-primary/5 text-primary"
            >
              {container.name}
            </Badge>
            {init ? (
              <Badge variant="secondary" className="text-xs">
                {container.restartPolicy === 'Always' ? 'Sidecar' : 'Init'}
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription className="truncate font-mono">
            {container.image || '-'}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={setTab}
          className="min-h-0 flex-1 gap-3"
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="details">
              {t('common.fields.details')}
            </TabsTrigger>
            <TabsTrigger value="env">{t('common.fields.env')}</TabsTrigger>
            <TabsTrigger value="mounts">
              {t('common.fields.mounts')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="min-h-0 overflow-y-auto pr-1">
            <ContainerInfoCard
              key={container.name}
              container={container}
              status={status}
              init={init}
              defaultExpanded
            />
          </TabsContent>

          <TabsContent value="env" className="min-h-0 overflow-y-auto pr-1">
            <ContainerEnvView container={container} />
          </TabsContent>

          <TabsContent value="mounts" className="min-h-0 overflow-y-auto pr-1">
            <ContainerMountsView container={container} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function ContainerEnvView({ container }: { container: Container }) {
  const { t } = useTranslation()
  const env = container.env || []
  const envFrom = container.envFrom || []

  if (env.length === 0 && envFrom.length === 0) {
    return (
      <div className="rounded-lg border px-4 py-8 text-sm text-muted-foreground">
        {t('pods.noEnvironmentVariables')}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {envFrom.length > 0 ? (
        <div className="rounded-lg border">
          <div className="border-b px-4 py-2 text-sm font-medium">
            {t('common.fields.envFrom')}
          </div>
          <div className="divide-y">
            {envFrom.map((source, index) => (
              <div
                key={index}
                className="flex min-w-0 items-center gap-2 px-4 py-2 text-sm"
              >
                {source.configMapRef ? (
                  <>
                    <Badge variant="outline">ConfigMap</Badge>
                    <span className="min-w-0 truncate font-mono">
                      {source.configMapRef.name || '-'}
                    </span>
                  </>
                ) : null}
                {source.secretRef ? (
                  <>
                    <Badge variant="outline">Secret</Badge>
                    <span className="min-w-0 truncate font-mono">
                      {source.secretRef.name || '-'}
                    </span>
                  </>
                ) : null}
                {source.prefix ? (
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    prefix: {source.prefix}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {env.length > 0 ? (
        <div className="rounded-lg border">
          <div className="border-b px-4 py-2 text-sm font-medium">
            {t('common.fields.variables')} ({env.length})
          </div>
          <div className="divide-y">
            {env.map((item) => (
              <div
                key={item.name}
                className="grid min-w-0 grid-cols-[12rem_minmax(0,1fr)] gap-3 px-4 py-2 text-sm"
              >
                <span className="truncate font-mono font-medium">
                  {item.name}
                </span>
                <span className="min-w-0 truncate font-mono text-muted-foreground">
                  {formatEnvValue(item)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ContainerMountsView({ container }: { container: Container }) {
  const { t } = useTranslation()
  const mounts = container.volumeMounts || []

  if (mounts.length === 0) {
    return (
      <div className="rounded-lg border px-4 py-8 text-sm text-muted-foreground">
        {t('pods.noVolumeMounts')}
      </div>
    )
  }

  return (
    <div className="rounded-lg border">
      <div className="border-b px-4 py-2 text-sm font-medium">
        {t('common.fields.volumeMounts')} ({mounts.length})
      </div>
      <div className="divide-y">
        {mounts.map((mount) => (
          <div
            key={`${mount.name}-${mount.mountPath}`}
            className="grid min-w-0 grid-cols-[12rem_minmax(0,1fr)_4rem] items-center gap-3 px-4 py-2 text-sm"
          >
            <Badge
              variant="outline"
              className="min-w-0 justify-start truncate font-mono"
              title={mount.name}
            >
              {mount.name}
            </Badge>
            <span className="min-w-0 truncate font-mono text-muted-foreground">
              {mount.mountPath}
              {mount.subPath ? `:${mount.subPath}` : ''}
            </span>
            <span className="text-right text-xs text-muted-foreground">
              {mount.readOnly ? 'RO' : 'RW'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatEnvValue(item: NonNullable<Container['env']>[number]) {
  if (item.value !== undefined) {
    return item.value
  }
  if (item.valueFrom?.secretKeyRef) {
    return `secret:${item.valueFrom.secretKeyRef.name || '-'}/${item.valueFrom.secretKeyRef.key || '-'}`
  }
  if (item.valueFrom?.configMapKeyRef) {
    return `configmap:${item.valueFrom.configMapKeyRef.name || '-'}/${item.valueFrom.configMapKeyRef.key || '-'}`
  }
  if (item.valueFrom?.fieldRef) {
    return `field:${item.valueFrom.fieldRef.fieldPath || '-'}`
  }
  if (item.valueFrom?.resourceFieldRef) {
    return `resource:${item.valueFrom.resourceFieldRef.resource || '-'}`
  }
  return '-'
}
