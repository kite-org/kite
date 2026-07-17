import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createColumnHelper } from '@tanstack/react-table'
import { StorageClass } from 'kubernetes-types/storage/v1'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { patchResource, useResources } from '@/lib/api'
import { createSearchFilter } from '@/lib/k8s'
import { formatDate, translateError } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ResourceTable } from '@/components/resource-table'

const defaultStorageClassAnnotation =
  'storageclass.kubernetes.io/is-default-class'
const betaDefaultStorageClassAnnotation =
  'storageclass.beta.kubernetes.io/is-default-class'

function isDefaultStorageClass(storageClass: StorageClass) {
  const annotations = storageClass.metadata?.annotations
  return (
    annotations?.[defaultStorageClassAnnotation] === 'true' ||
    annotations?.[betaDefaultStorageClassAnnotation] === 'true'
  )
}

const storageClassSearchFilter = createSearchFilter<StorageClass>(
  (storageClass) => storageClass.metadata?.name,
  (storageClass) => storageClass.provisioner
)

const columnHelper = createColumnHelper<StorageClass>()

export function StorageClassListPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: storageClasses = [] } = useResources(
    'storageclasses',
    undefined,
    { reduce: true }
  )
  const defaultStorageClassCount = storageClasses.filter(
    isDefaultStorageClass
  ).length
  const setDefaultMutation = useMutation({
    mutationFn: async (storageClass: StorageClass) => {
      const name = storageClass.metadata!.name!
      const currentDefaults = storageClasses.filter(
        (item) => item.metadata?.name !== name && isDefaultStorageClass(item)
      )

      await patchResource('storageclasses', name, undefined, {
        metadata: {
          annotations: {
            [defaultStorageClassAnnotation]: 'true',
          },
        },
      })
      const results = await Promise.allSettled(
        currentDefaults.map((item) =>
          patchResource('storageclasses', item.metadata!.name!, undefined, {
            metadata: {
              annotations: {
                [defaultStorageClassAnnotation]: 'false',
                [betaDefaultStorageClassAnnotation]: 'false',
              },
            },
          })
        )
      )
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error(t('storageClasses.messages.clearDefaultsFailed'))
      }
    },
    onSuccess: (_, storageClass) => {
      toast.success(
        t('storageClasses.messages.setDefaultSuccess', {
          name: storageClass.metadata!.name,
        })
      )
    },
    onError: (error) => {
      toast.error(translateError(error, t))
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ['storageclasses'] }),
  })

  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.fields.name'),
        cell: ({ row }) => (
          <div className="font-medium app-link">
            <Link to={`/storageclasses/${row.original.metadata!.name}`}>
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor('provisioner', {
        header: t('storageClasses.fields.provisioner'),
        enableColumnFilter: true,
      }),
      columnHelper.accessor((row) => row.reclaimPolicy || 'Delete', {
        id: 'reclaimPolicy',
        header: t('common.fields.reclaimPolicy'),
        cell: ({ getValue }) => getValue() || 'Delete',
      }),
      columnHelper.accessor((row) => row.volumeBindingMode || 'Immediate', {
        id: 'volumeBindingMode',
        header: t('storageClasses.fields.volumeBindingMode'),
        cell: ({ getValue }) => getValue() || 'Immediate',
      }),
      columnHelper.accessor((row) => row.allowVolumeExpansion ?? false, {
        id: 'allowVolumeExpansion',
        header: t('storageClasses.fields.allowVolumeExpansion'),
        cell: ({ getValue }) =>
          getValue() === true ? t('common.values.yes') : t('common.values.no'),
      }),
      columnHelper.accessor(isDefaultStorageClass, {
        id: 'default',
        header: t('storageClasses.fields.default'),
        cell: ({ getValue }) =>
          getValue() ? (
            <Badge variant="secondary">
              {t('storageClasses.fields.default')}
            </Badge>
          ) : (
            '-'
          ),
      }),
      columnHelper.accessor('metadata.creationTimestamp', {
        header: t('common.fields.created'),
        cell: ({ getValue }) => (
          <span className="text-muted-foreground text-sm tabular-nums">
            {formatDate(getValue() || '')}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: t('common.fields.actions'),
        cell: ({ row }) => {
          if (
            isDefaultStorageClass(row.original) &&
            defaultStorageClassCount === 1
          ) {
            return '-'
          }

          const isCurrent =
            setDefaultMutation.variables?.metadata?.name ===
            row.original.metadata?.name

          return (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              disabled={setDefaultMutation.isPending}
              onClick={() => setDefaultMutation.mutate(row.original)}
            >
              {isCurrent && setDefaultMutation.isPending
                ? t('storageClasses.actions.settingDefault')
                : t('storageClasses.actions.setDefault')}
            </Button>
          )
        },
      }),
    ],
    [defaultStorageClassCount, setDefaultMutation, t]
  )

  return (
    <ResourceTable
      resourceName="StorageClasses"
      resourceType="storageclasses"
      columns={columns}
      clusterScope={true}
      searchQueryFilter={storageClassSearchFilter}
    />
  )
}
