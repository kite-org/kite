import { useState, type FormEvent } from 'react'
import * as yaml from 'js-yaml'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import type {
  HelmChartDetail,
  HelmReleaseDryRunResponse,
  HelmReleaseInstallRequest,
} from '@/types/api'
import {
  dryRunInstallHelmRelease,
  installHelmRelease,
  useHelmChartContent,
} from '@/lib/api'
import { translateError } from '@/lib/utils'
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
import { NamespaceSelector } from '@/components/selector/namespace-selector'
import { SimpleYamlEditor } from '@/components/simple-yaml-editor'
import { YamlFileTreeViewerNative as YamlFileTreeViewer } from '@/components/yaml-file-tree-viewer-native'

function defaultReleaseName(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || name
  )
}

export function HelmInstallDialog({
  chart,
  open,
  onOpenChange,
}: {
  chart: HelmChartDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [releaseName, setReleaseName] = useState(() =>
    defaultReleaseName(chart.name)
  )
  const [namespace, setNamespace] = useState('default')
  const [isNamespaceManual, setIsNamespaceManual] = useState(false)
  const [createNamespace, setCreateNamespace] = useState(true)
  const [valuesYaml, setValuesYaml] = useState('')
  const [error, setError] = useState('')
  const [isInstalling, setIsInstalling] = useState(false)
  const [isDryRunning, setIsDryRunning] = useState(false)
  const [dryRunPreview, setDryRunPreview] =
    useState<HelmReleaseDryRunResponse | null>(null)
  const defaultValuesQuery = useHelmChartContent(
    chart.repositoryName,
    chart.name,
    'values',
    chart.version,
    chart.source,
    open
  )
  const defaultValues = defaultValuesQuery.isLoading
    ? t('common.messages.loading')
    : defaultValuesQuery.data?.content || ''
  const readableError = error.replace(/\s&&\s/g, '\n')

  const buildInstallRequest = (): {
    targetNamespace: string
    request: HelmReleaseInstallRequest
  } | null => {
    setError('')

    if (!chart.chartUrl) {
      setError(
        t('helmCharts.messages.noChartUrl', {
          defaultValue: 'Chart package URL is missing.',
        })
      )
      return null
    }

    let values: Record<string, unknown> = {}
    if (valuesYaml.trim()) {
      try {
        const parsed = yaml.load(valuesYaml)
        if (parsed && (typeof parsed !== 'object' || Array.isArray(parsed))) {
          setError(
            t('helmCharts.messages.invalidValues', {
              defaultValue: 'Values must be a YAML object.',
            })
          )
          return null
        }
        values = (parsed || {}) as Record<string, unknown>
      } catch (err) {
        setError(translateError(err, t))
        return null
      }
    }

    const targetNamespace = namespace.trim()
    const request = {
      releaseName: releaseName.trim(),
      namespace: targetNamespace,
      chartUrl: chart.chartUrl,
      repositoryName: chart.repositoryName,
      source: chart.source,
      createNamespace: isNamespaceManual && createNamespace,
      values,
    }

    return { targetNamespace, request }
  }

  const handleDryRun = async () => {
    const payload = buildInstallRequest()
    if (!payload) {
      return
    }

    setIsDryRunning(true)
    try {
      const preview = await dryRunInstallHelmRelease(
        payload.targetNamespace,
        payload.request
      )
      setDryRunPreview(preview)
    } catch (err) {
      setError(translateError(err, t))
    } finally {
      setIsDryRunning(false)
    }
  }

  const handleInstall = async () => {
    const payload = buildInstallRequest()
    if (!payload) {
      return
    }

    setIsInstalling(true)
    try {
      const release = await installHelmRelease(
        payload.targetNamespace,
        payload.request
      )
      const installedNamespace =
        release.metadata?.namespace || payload.targetNamespace
      const targetName = release.metadata?.name || releaseName.trim()
      toast.success(
        t('helmCharts.messages.installed', {
          defaultValue: 'Helm release installed',
        })
      )
      onOpenChange(false)
      navigate(
        `/helmrelease/${encodeURIComponent(installedNamespace)}/${encodeURIComponent(targetName)}`
      )
    } catch (err) {
      setError(translateError(err, t))
    } finally {
      setIsInstalling(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (dryRunPreview) {
      await handleInstall()
      return
    }
    await handleDryRun()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[calc(100dvh-4rem)] max-h-[calc(100dvh-4rem)] w-[calc(100vw-4rem)] !max-w-[calc(100vw-4rem)] flex-col overflow-hidden"
        onPointerDownOutside={(event) => {
          event.preventDefault()
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault()
        }}
      >
        <form
          onSubmit={handleSubmit}
          className="flex h-full min-h-0 flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>
              {t('helmCharts.actions.install', { defaultValue: 'Install' })}
            </DialogTitle>
            <DialogDescription>
              {chart.repositoryName}/{chart.name}:{chart.version}
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <div
              role="alert"
              className="max-h-40 overflow-y-auto rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm leading-5"
            >
              <div className="mb-1 font-medium text-destructive">
                {t('common.fields.errorDetails')}
              </div>
              <pre className="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
                {readableError}
              </pre>
            </div>
          ) : null}

          <div
            className={
              dryRunPreview
                ? 'flex min-h-0 flex-1 flex-col gap-4 overflow-hidden pr-1'
                : 'min-h-0 flex-1 space-y-4 overflow-y-auto pr-1'
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="helm-release-name">
                  {t('helm.fields.releaseName')}
                </Label>
                <Input
                  id="helm-release-name"
                  value={releaseName}
                  onChange={(event) => {
                    setReleaseName(event.target.value)
                    setDryRunPreview(null)
                  }}
                  disabled={isInstalling || isDryRunning || !!dryRunPreview}
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="helm-release-namespace">
                  {t('common.fields.namespace', { defaultValue: 'Namespace' })}
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  <NamespaceSelector
                    selectedNamespace={namespace}
                    handleNamespaceChange={(value) => {
                      setNamespace(value)
                      setIsNamespaceManual(false)
                      setDryRunPreview(null)
                    }}
                    disabled={isInstalling || isDryRunning || !!dryRunPreview}
                    triggerClassName="w-44 sm:w-44 sm:min-w-0"
                    modal
                  />
                  <Input
                    id="helm-release-namespace"
                    value={namespace}
                    onChange={(event) => {
                      setNamespace(event.target.value)
                      setIsNamespaceManual(true)
                      setCreateNamespace(true)
                      setDryRunPreview(null)
                    }}
                    disabled={isInstalling || isDryRunning || !!dryRunPreview}
                    required
                    className="w-48"
                  />
                </div>
              </div>
            </div>

            {dryRunPreview ? (
              <YamlFileTreeViewer
                files={dryRunPreview.resources}
                title={t('helm.fields.dryRunPreview')}
                emptyMessage={t('helm.messages.noDryRunResources')}
                fillHeight
              />
            ) : (
              <div className="grid min-h-0 gap-4 lg:grid-cols-2">
                <div className="grid min-h-0 gap-2">
                  <Label>{t('helmCharts.fields.defaultValues')}</Label>
                  <SimpleYamlEditor
                    value={defaultValues}
                    onChange={() => undefined}
                    disabled
                    height="calc(100dvh - 20rem)"
                  />
                </div>

                <div className="grid min-h-0 gap-2">
                  <Label>{t('helmCharts.fields.customValues')}</Label>
                  <SimpleYamlEditor
                    value={valuesYaml}
                    onChange={(value) => {
                      setValuesYaml(value || '')
                      setDryRunPreview(null)
                    }}
                    disabled={isInstalling || isDryRunning}
                    height="calc(100dvh - 20rem)"
                  />
                </div>
              </div>
            )}

            {defaultValuesQuery.error ? (
              <p className="text-sm text-destructive">
                {translateError(defaultValuesQuery.error, t)}
              </p>
            ) : null}
          </div>

          <DialogFooter className="items-center gap-3 sm:justify-end">
            {!dryRunPreview && isNamespaceManual ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="helm-create-namespace"
                  checked={createNamespace}
                  onCheckedChange={(value) => {
                    setCreateNamespace(value === true)
                    setDryRunPreview(null)
                  }}
                  disabled={isInstalling || isDryRunning}
                />
                <Label
                  htmlFor="helm-create-namespace"
                  className="text-sm font-normal"
                >
                  {t('helm.fields.createNamespace')}
                </Label>
              </div>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              {dryRunPreview ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDryRunPreview(null)}
                  disabled={isInstalling || isDryRunning}
                >
                  {t('helm.actions.backToValues')}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isInstalling || isDryRunning}
                >
                  {t('common.actions.cancel')}
                </Button>
              )}
              {!dryRunPreview ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleDryRun()}
                  disabled={
                    !releaseName.trim() ||
                    !namespace.trim() ||
                    !chart.chartUrl ||
                    isInstalling ||
                    isDryRunning
                  }
                >
                  {isDryRunning ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {t('helm.actions.dryRun')}
                </Button>
              ) : null}
              <Button
                type="button"
                onClick={() => void handleInstall()}
                disabled={
                  !releaseName.trim() ||
                  !namespace.trim() ||
                  !chart.chartUrl ||
                  isInstalling ||
                  isDryRunning
                }
              >
                {isInstalling ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {t('helmCharts.actions.install', { defaultValue: 'Install' })}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
