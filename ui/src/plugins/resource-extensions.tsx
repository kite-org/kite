import { useEffect, useMemo } from 'react'
import type { PluginResourceColumn } from '@kite-dev/plugin-sdk'
import type { ResourceReference } from '@kite-dev/plugin-sdk/resources'
import {
  flexRender,
  type ColumnDef,
  type VisibilityState,
} from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { getResourceCatalogEntry } from '@/lib/resource-catalog'

import { usePlugins } from './plugin-context'
import { PluginContent, PluginView } from './plugin-view'
import { PluginResourceContext } from './resource-context'
import { pluginLabel } from './sidebar'

function useResourceExtensions(resourceType?: string) {
  const { plugins, loadPlugin } = usePlugins()
  const reference = useMemo<ResourceReference | undefined>(() => {
    if (!resourceType) return
    const entry = getResourceCatalogEntry(resourceType)
    if (entry && 'apiGroup' in entry) {
      return {
        group: entry.apiGroup,
        resource:
          resourceType === 'crds' ? 'customresourcedefinitions' : entry.type,
        scope: entry.clusterScope ? 'Cluster' : 'Namespaced',
      }
    }
    const separator = resourceType.indexOf('.')
    if (separator !== -1)
      return {
        resource: resourceType.slice(0, separator),
        group: resourceType.slice(separator + 1),
      }
  }, [resourceType])
  const entries = useMemo(
    () =>
      reference
        ? plugins.flatMap((plugin) => {
            if (plugin.invalid) return []
            const resource = plugin.manifest.resources.find(
              (entry) =>
                entry.group === reference.group &&
                entry.resource === reference.resource
            )
            if (!resource) return []
            const definition = plugin.module?.resources.find(
              (entry) =>
                entry.group === reference.group &&
                entry.resource === reference.resource
            )
            return [{ plugin, resource, definition }]
          })
        : [],
    [plugins, reference]
  )
  return { entries, reference, loadPlugin }
}

function compareExtensions(
  a: { id: string; order?: number },
  b: { id: string; order?: number }
) {
  return (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)
}

export function usePluginColumnContributions(
  resourceType: string,
  visibility: VisibilityState
) {
  const { entries, reference, loadPlugin } = useResourceExtensions(resourceType)
  const contributions = useMemo(
    () =>
      entries
        .flatMap(({ plugin, resource, definition }) =>
          (resource.columns ?? []).map((metadata) => ({
            plugin,
            column: definition?.columns?.find(
              (column) => column.id === metadata.id
            ),
            metadata,
            order: metadata.order,
            id: `plugin:${plugin.manifest.id}:column:${metadata.id}`,
          }))
        )
        .sort(compareExtensions),
    [entries]
  )
  const columnVisibility = useMemo(
    () => ({
      ...Object.fromEntries(
        contributions.map(({ id, metadata }) => [id, !metadata.defaultHidden])
      ),
      ...visibility,
    }),
    [contributions, visibility]
  )
  const visibleContributions = useMemo(
    () => contributions.filter(({ id }) => columnVisibility[id]),
    [contributions, columnVisibility]
  )

  useEffect(() => {
    for (const id of new Set(
      visibleContributions.map(({ plugin }) => plugin.manifest.id)
    ))
      loadPlugin(id)
  }, [visibleContributions, loadPlugin])

  return {
    contributions,
    reference,
    columnVisibility,
    hasVisibleColumns: visibleContributions.length > 0,
  }
}

export function usePluginResourceColumns<T>({
  extensions: { contributions, reference },
  onRefresh,
}: {
  extensions: ReturnType<typeof usePluginColumnContributions>
  onRefresh: () => Promise<unknown>
}) {
  const { t, i18n } = useTranslation()
  return useMemo<ColumnDef<T>[]>(
    () =>
      contributions.map(({ plugin, column: implementation, metadata, id }) => {
        const column: PluginResourceColumn<T> | undefined = implementation
        let reportedError = false
        const reportError = (error: unknown) => {
          if (!reportedError)
            console.error(
              `[Plugin ${plugin.manifest.id}] Column ${metadata.id}`,
              error
            )
          reportedError = true
        }
        const accessor =
          column?.accessorFn ??
          (column?.accessorKey !== undefined
            ? (row: T) =>
                String(column.accessorKey)
                  .split('.')
                  .reduce<unknown>(
                    (value, key) =>
                      (value as Record<string, unknown> | undefined)?.[key],
                    row
                  )
            : undefined)
        const sortingFn = column?.sortingFn
        const errorFallback = (
          <span
            className="text-muted-foreground"
            title={t('plugins.loadFailed')}
          >
            —
          </span>
        )
        return {
          id,
          header: pluginLabel(metadata.header, i18n.language),
          size: column?.size,
          minSize: column?.minSize,
          maxSize: column?.maxSize,
          enableHiding: column?.enableHiding,
          enableSorting: !!accessor && column?.enableSorting !== false,
          sortDescFirst: column?.sortDescFirst,
          sortUndefined: column?.sortUndefined ?? 1,
          invertSorting: column?.invertSorting,
          accessorFn: accessor
            ? (row, index) => {
                try {
                  return accessor(row, index)
                } catch (error) {
                  reportError(error)
                  return undefined
                }
              }
            : undefined,
          sortingFn:
            typeof sortingFn === 'function'
              ? (a, b, columnId) => {
                  try {
                    return sortingFn(a, b, columnId)
                  } catch (error) {
                    reportError(error)
                    return 0
                  }
                }
              : (sortingFn ?? 'auto'),
          cell: (context) => (
            <PluginResourceContext.Provider
              value={{
                resource: context.row.original,
                reference: reference!,
                onRefresh,
              }}
            >
              <PluginContent
                plugin={plugin}
                fallback={errorFallback}
                errorFallback={errorFallback}
              >
                {() =>
                  column?.cell
                    ? flexRender(column.cell, context)
                    : String(context.getValue() ?? '—')
                }
              </PluginContent>
            </PluginResourceContext.Provider>
          ),
        }
      }),
    [contributions, reference, onRefresh, t, i18n.language]
  )
}

export function usePluginResourceTabs<T>({
  resourceType,
  resource,
  onRefresh,
}: {
  resourceType?: string
  resource: T
  onRefresh: () => Promise<unknown>
}) {
  const { entries, reference } = useResourceExtensions(resourceType)
  const { t, i18n } = useTranslation()
  return useMemo(
    () =>
      entries
        .flatMap(({ plugin, resource: target, definition }) =>
          (target.tabs ?? []).map((tab) => ({
            id: `plugin:${plugin.manifest.id}:tab:${tab.id}`,
            value: `plugin:${plugin.manifest.id}:tab:${tab.id}`,
            order: tab.order,
            label: pluginLabel(tab.label, i18n.language),
            content: (
              <PluginResourceContext.Provider
                value={{ resource, reference: reference!, onRefresh }}
              >
                <PluginView
                  key={`${plugin.assetBaseUrl}:${tab.id}`}
                  plugin={plugin}
                  fallback={
                    <p role="alert" className="text-sm text-muted-foreground">
                      {t('plugins.loadFailed')}
                    </p>
                  }
                >
                  {() =>
                    definition!.tabs!.find((entry) => entry.id === tab.id)!
                      .element
                  }
                </PluginView>
              </PluginResourceContext.Provider>
            ),
          }))
        )
        .sort(compareExtensions),
    [entries, reference, resource, onRefresh, t, i18n.language]
  )
}
