import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { IconLoader, IconRefresh, IconTrash } from '@tabler/icons-react'
import * as yaml from 'js-yaml'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { type ResourceType } from '@/types/api'
import { translateError } from '@/lib/utils'
import { usePageTitle } from '@/hooks/use-page-title'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import { DescribeDialog } from '@/components/describe-dialog'
import { ErrorMessage } from '@/components/error-message'
import { ResourceDeleteConfirmationDialog } from '@/components/resource-delete-confirmation-dialog'
import { YamlEditor } from '@/components/yaml-editor'

export interface ResourceDetailShellContext<T> {
  resource: T
  yamlContent: string
  setYamlContent: (value: string) => void
  refreshKey: number
  isSavingYaml: boolean
  onRefresh: () => Promise<unknown>
}

export interface ResourceDetailShellTab<T> {
  value: string
  label: ReactNode
  content: ReactNode | ((context: ResourceDetailShellContext<T>) => ReactNode)
}

interface ResourceDetailShellProps<T> {
  resourceType: ResourceType
  resourceLabel: string
  name: string
  namespace?: string
  data: T | undefined
  isLoading: boolean
  error: Error | unknown | null
  onRefresh: () => Promise<unknown>
  onSaveYaml?: (content: T) => Promise<unknown>
  overview: ReactNode | ((context: ResourceDetailShellContext<T>) => ReactNode)
  preYamlTabs?: ResourceDetailShellTab<T>[]
  extraTabs?: ResourceDetailShellTab<T>[]
  headerActions?: ReactNode
  yamlToolbar?:
    | ReactNode
    | ((context: ResourceDetailShellContext<T>) => ReactNode)
  loadingMessage?: string
  yamlTabLabel?: ReactNode
  showDelete?: boolean
}

export function ResourceDetailShell<T>({
  resourceType,
  resourceLabel,
  name,
  namespace,
  data,
  isLoading,
  error,
  onRefresh,
  onSaveYaml,
  overview,
  preYamlTabs = [],
  extraTabs = [],
  headerActions,
  yamlToolbar,
  loadingMessage,
  yamlTabLabel = 'YAML',
  showDelete = true,
}: ResourceDetailShellProps<T>) {
  const { t } = useTranslation()
  const [yamlContent, setYamlContent] = useState('')
  const [isSavingYaml, setIsSavingYaml] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  usePageTitle(name ? `${name} (${resourceLabel})` : resourceLabel)

  useEffect(() => {
    if (data) {
      setYamlContent(yaml.dump(data, { indent: 2 }))
    }
  }, [data])

  const handleRefresh = useCallback(async () => {
    setRefreshKey((prev) => prev + 1)
    setIsRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsRefreshing(false)
    }
  }, [onRefresh])

  const handleSaveYaml = useCallback(
    async (content: T) => {
      if (!onSaveYaml) {
        return
      }

      setIsSavingYaml(true)
      try {
        await onSaveYaml(content)
      } catch (saveError) {
        toast.error(translateError(saveError, t))
      } finally {
        setIsSavingYaml(false)
      }
    },
    [onSaveYaml, t]
  )

  const shellContext = useMemo<ResourceDetailShellContext<T>>(
    () => ({
      resource: data as T,
      yamlContent,
      setYamlContent,
      refreshKey,
      isSavingYaml,
      onRefresh: handleRefresh,
    }),
    [data, handleRefresh, isSavingYaml, refreshKey, yamlContent]
  )

  const tabs = useMemo(() => {
    const resolvedTabs: ResourceDetailShellTab<T>[] = [
      {
        value: 'overview',
        label: 'Overview',
        content: overview,
      },
    ]

    resolvedTabs.push(...preYamlTabs)

    if (onSaveYaml) {
      resolvedTabs.push({
        value: 'yaml',
        label: yamlTabLabel,
        content: (
          <div className="space-y-4">
            {yamlToolbar ? (
              <div className="flex justify-end">
                {typeof yamlToolbar === 'function'
                  ? yamlToolbar(shellContext)
                  : yamlToolbar}
              </div>
            ) : null}
            <YamlEditor
              key={refreshKey}
              value={yamlContent}
              title="YAML Configuration"
              onSave={(value) => {
                void handleSaveYaml(value as T)
              }}
              onChange={setYamlContent}
              isSaving={isSavingYaml}
            />
          </div>
        ),
      })
    }

    return [...resolvedTabs, ...extraTabs]
  }, [
    extraTabs,
    handleSaveYaml,
    isSavingYaml,
    preYamlTabs,
    onSaveYaml,
    overview,
    shellContext,
    refreshKey,
    yamlContent,
    yamlTabLabel,
    yamlToolbar,
  ])

  if (isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-center gap-2">
              <IconLoader className="animate-spin" />
              <span>
                {loadingMessage ||
                  `Loading ${resourceLabel.toLowerCase()} details...`}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error || !data) {
    if (!data && !error) {
      return (
        <div className="p-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                {resourceLabel} not found
              </div>
            </CardContent>
          </Card>
        </div>
      )
    }

    return (
      <ErrorMessage
        resourceName={resourceLabel}
        error={error}
        refetch={handleRefresh}
      />
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">{name}</h1>
          {namespace ? (
            <p className="text-muted-foreground">
              Namespace: <span className="font-medium">{namespace}</span>
            </p>
          ) : null}
        </div>
        <div className="flex w-full flex-wrap gap-2 md:w-auto md:justify-end">
          <Button
            disabled={isLoading || isRefreshing}
            variant="outline"
            size="sm"
            onClick={handleRefresh}
          >
            <IconRefresh className="w-4 h-4" />
            Refresh
          </Button>
          <DescribeDialog
            resourceType={resourceType}
            namespace={namespace}
            name={name}
          />
          {headerActions}
          {showDelete && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setIsDeleteDialogOpen(true)}
            >
              <IconTrash className="w-4 h-4" />
              Delete
            </Button>
          )}
        </div>
      </div>

      <ResponsiveTabs
        tabs={tabs.map((tab) => ({
          value: tab.value,
          label: tab.label,
          content:
            typeof tab.content === 'function'
              ? tab.content(shellContext)
              : tab.content,
        }))}
      />

      {showDelete && (
        <ResourceDeleteConfirmationDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          resourceName={name}
          resourceType={resourceType}
          namespace={namespace}
        />
      )}
    </div>
  )
}
