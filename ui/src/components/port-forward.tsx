import { useId, useState } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Cable, Copy, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { apiClient } from '@/lib/api-client'
import { withCurrentClusterPath } from '@/lib/current-cluster'
import { isDesktop } from '@/lib/desktop'
import { useCluster } from '@/hooks/use-cluster'
import { Badge } from '@/components/ui/badge'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Forward {
  id: string
  cluster: string
  namespace: string
  resource: 'pods' | 'services'
  name: string
  pod: string
  podPort: number
  remotePort: number
  localPort: number
  status: 'active' | 'disconnected'
  error?: string
}

interface Target {
  resource: 'pods' | 'services'
  namespace: string
  name: string
  ports: { port: number; name?: string }[]
}

const endpoint = '/desktop/port-forwards'
const queryKey = ['desktop-port-forwards']

function ForwardAddress({ forward }: { forward: Forward }) {
  const { t } = useTranslation()
  const address = `127.0.0.1:${forward.localPort}`
  return (
    <div className="flex items-center gap-2">
      <code className="text-sm tabular-nums">{address}</code>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('portForward.copyAddress')}
        title={t('portForward.copyAddress')}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(address)
            toast.success(t('portForward.copied'))
          } catch {
            toast.error(t('portForward.copyFailed'))
          }
        }}
      >
        <Copy className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        asChild
        aria-label={t('portForward.openHTTP')}
        title={t('portForward.openHTTP')}
      >
        <a href={`http://${address}`} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="size-4" />
        </a>
      </Button>
    </div>
  )
}

function StartForwardDialog({
  target,
  cluster,
  onClose,
}: {
  target: Target
  cluster: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const queryClient = useQueryClient()
  const [remotePort, setRemotePort] = useState(
    target.ports[0]?.port.toString() ?? ''
  )
  const [localPort, setLocalPort] = useState('')
  const start = useMutation({
    mutationFn: () =>
      apiClient.post<Forward>(withCurrentClusterPath(endpoint, cluster), {
        resource: target.resource,
        namespace: target.namespace,
        name: target.name,
        remotePort: Number(remotePort),
        localPort: Number(localPort),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !start.isPending && onClose()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('portForward.title')}</DialogTitle>
          <DialogDescription className="break-all">
            {cluster} / {target.namespace} /{' '}
            {target.resource === 'pods' ? 'Pod' : 'Service'} / {target.name}
          </DialogDescription>
        </DialogHeader>
        {start.data ? (
          <>
            <p role="status" className="text-sm">
              {t('portForward.started')}
            </p>
            <ForwardAddress forward={start.data} />
            <p className="break-all text-sm text-muted-foreground">
              → {start.data.pod}:{start.data.podPort}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('portForward.lifetime')}
            </p>
            <DialogFooter>
              <Button onClick={onClose}>{t('portForward.done')}</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              start.mutate()
            }}
          >
            <div className="space-y-2">
              <Label htmlFor={`${id}-remote`}>
                {t(
                  target.resource === 'services'
                    ? 'portForward.servicePort'
                    : 'portForward.podPort'
                )}
              </Label>
              {target.resource === 'services' ? (
                <Select value={remotePort} onValueChange={setRemotePort}>
                  <SelectTrigger id={`${id}-remote`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {target.ports.map((port) => (
                      <SelectItem key={port.port} value={String(port.port)}>
                        {port.port} {port.name ? `(${port.name})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <>
                  <Input
                    id={`${id}-remote`}
                    type="number"
                    min={1}
                    max={65535}
                    required
                    value={remotePort}
                    onChange={(event) => setRemotePort(event.target.value)}
                    list={`${id}-ports`}
                  />
                  <datalist id={`${id}-ports`}>
                    {target.ports.map((port) => (
                      <option key={port.port} value={port.port}>
                        {port.name}
                      </option>
                    ))}
                  </datalist>
                </>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-local`}>
                {t('portForward.localPort')}
              </Label>
              <Input
                id={`${id}-local`}
                type="number"
                min={0}
                max={65535}
                value={localPort}
                onChange={(event) => setLocalPort(event.target.value)}
                placeholder={t('portForward.automatic')}
                aria-describedby={`${id}-hint`}
              />
              <p id={`${id}-hint`} className="text-sm text-muted-foreground">
                {t('portForward.localHint')}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('portForward.lifetime')}
            </p>
            {start.error && (
              <p role="alert" className="break-words text-sm text-destructive">
                {start.error.message}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={start.isPending}
              >
                {t('portForward.cancel')}
              </Button>
              <Button type="submit" disabled={start.isPending || !remotePort}>
                {t(
                  start.isPending ? 'portForward.starting' : 'portForward.start'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function PortForwardButton({
  disabled,
  ...target
}: Target & { disabled?: boolean }) {
  const { t } = useTranslation()
  const { currentCluster } = useCluster()
  const [open, setOpen] = useState(false)
  if (!isDesktop) return null
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || !currentCluster}
        onClick={() => setOpen(true)}
      >
        <Cable className="size-4" />
        {t('portForward.title')}
      </Button>
      {open && currentCluster && (
        <StartForwardDialog
          key={`${currentCluster}/${target.namespace}/${target.name}`}
          target={target}
          cluster={currentCluster}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

export function PortForwardManager() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const forwards = useQuery({
    queryKey: [...queryKey, user?.Key()],
    queryFn: () => apiClient.get<Forward[]>(endpoint),
    enabled: !!user,
    refetchInterval: 2000,
  })
  const stop = useMutation({
    mutationFn: (id: string) => apiClient.delete(`${endpoint}/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (error) => toast.error(error.message),
  })
  const count =
    forwards.data?.filter((item) => item.status === 'active').length ?? 0
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={t('portForward.manageCount', { count })}
        title={t('portForward.manage')}
      >
        <Cable className="size-5" />
        {count > 0 && <span className="tabular-nums">{count}</span>}
      </Button>
      <Dialog
        open={open || location.hash === '#port-forwards'}
        onOpenChange={(value) => {
          setOpen(value)
          if (!value && location.hash === '#port-forwards') {
            navigate(
              {
                pathname: location.pathname,
                search: location.search,
                hash: '',
              },
              { replace: true }
            )
          }
        }}
      >
        <DialogContent className="sm:max-w-xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('portForward.manage')}</DialogTitle>
            <DialogDescription>{t('portForward.lifetime')}</DialogDescription>
          </DialogHeader>
          {forwards.isPending && (
            <p role="status">{t('portForward.loading')}</p>
          )}
          {forwards.error && (
            <div role="alert" className="space-y-2">
              <p className="text-sm text-destructive">
                {forwards.error.message}
              </p>
              <Button variant="outline" onClick={() => forwards.refetch()}>
                {t('portForward.retry')}
              </Button>
            </div>
          )}
          {forwards.data?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('portForward.empty')}
            </p>
          )}
          <div className="space-y-3">
            {forwards.data?.map((item) => (
              <div key={item.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="break-all text-sm font-medium">
                      {item.resource === 'pods' ? 'Pod' : 'Service'} /{' '}
                      {item.name}:{item.remotePort}
                    </p>
                    <p className="break-all text-xs text-muted-foreground">
                      {item.cluster} / {item.namespace}
                    </p>
                  </div>
                  <Badge
                    variant={
                      item.status === 'active' ? 'secondary' : 'destructive'
                    }
                  >
                    {t(`portForward.${item.status}`)}
                  </Badge>
                </div>
                {item.status === 'active' && <ForwardAddress forward={item} />}
                <p className="break-all text-xs text-muted-foreground">
                  127.0.0.1:{item.localPort} → {item.pod}:{item.podPort}
                </p>
                {item.error && (
                  <p className="break-words text-sm text-destructive">
                    {item.error}
                  </p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={stop.isPending && stop.variables === item.id}
                  onClick={() => stop.mutate(item.id)}
                >
                  {t(
                    item.status === 'active'
                      ? 'portForward.stop'
                      : 'portForward.remove'
                  )}
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
