import { useMemo } from 'react'
import {
  createColumnHelper,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { KubernetesResource, ResourceType } from '@/types/api'
import { useResources } from '@/lib/api'
import { createSearchFilter } from '@/lib/k8s'
import { formatDate } from '@/lib/utils'
import { useResourceTableState } from '@/hooks/use-resource-table-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ErrorMessage } from '@/components/error-message'
import { ResourceTableView } from '@/components/resource-table-view'

const POLICY_SOURCES: { resourceType: ResourceType; kind: string }[] = [
  {
    resourceType: 'validatingwebhookconfigurations',
    kind: 'ValidatingWebhookConfiguration',
  },
  {
    resourceType: 'mutatingwebhookconfigurations',
    kind: 'MutatingWebhookConfiguration',
  },
  {
    resourceType: 'validatingadmissionpolicies',
    kind: 'ValidatingAdmissionPolicy',
  },
  {
    resourceType: 'validatingadmissionpolicybindings',
    kind: 'ValidatingAdmissionPolicyBinding',
  },
  {
    resourceType: 'mutatingadmissionpolicies',
    kind: 'MutatingAdmissionPolicy',
  },
  {
    resourceType: 'mutatingadmissionpolicybindings',
    kind: 'MutatingAdmissionPolicyBinding',
  },
]

type PolicyRow = KubernetesResource & {
  _kind: string
  _resourceType: ResourceType
}

const columnHelper = createColumnHelper<PolicyRow>()

const policySearchFilter = createSearchFilter<PolicyRow>(
  (policy) => policy.metadata?.name,
  (policy) => policy._kind
)

export function PoliciesListPage() {
  const { t } = useTranslation()

  const validatingWebhooks = useResources(
    'validatingwebhookconfigurations',
    undefined,
    { reduce: true }
  )
  const mutatingWebhooks = useResources(
    'mutatingwebhookconfigurations',
    undefined,
    { reduce: true }
  )
  const validatingPolicies = useResources(
    'validatingadmissionpolicies',
    undefined,
    { reduce: true }
  )
  const validatingPolicyBindings = useResources(
    'validatingadmissionpolicybindings',
    undefined,
    { reduce: true }
  )
  const mutatingPolicies = useResources(
    'mutatingadmissionpolicies',
    undefined,
    { reduce: true }
  )
  const mutatingPolicyBindings = useResources(
    'mutatingadmissionpolicybindings',
    undefined,
    { reduce: true }
  )

  const queries = [
    validatingWebhooks,
    mutatingWebhooks,
    validatingPolicies,
    validatingPolicyBindings,
    mutatingPolicies,
    mutatingPolicyBindings,
  ]

  const isLoading = queries.some((query) => query.isLoading)
  const firstError = queries.find((query) => query.isError)?.error

  const rows = useMemo(() => {
    const dataByType: Partial<
      Record<ResourceType, KubernetesResource[] | undefined>
    > = {
      validatingwebhookconfigurations: validatingWebhooks.data,
      mutatingwebhookconfigurations: mutatingWebhooks.data,
      validatingadmissionpolicies: validatingPolicies.data,
      validatingadmissionpolicybindings: validatingPolicyBindings.data,
      mutatingadmissionpolicies: mutatingPolicies.data,
      mutatingadmissionpolicybindings: mutatingPolicyBindings.data,
    }
    return POLICY_SOURCES.flatMap((source) =>
      (dataByType[source.resourceType] || []).map((item) => ({
        ...item,
        _kind: source.kind,
        _resourceType: source.resourceType,
      }))
    )
  }, [
    validatingWebhooks.data,
    mutatingWebhooks.data,
    validatingPolicies.data,
    validatingPolicyBindings.data,
    mutatingPolicies.data,
    mutatingPolicyBindings.data,
  ])

  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.fields.name'),
        cell: ({ row }) => (
          <div className="font-medium app-link">
            <Link
              to={`/${row.original._resourceType}/${row.original.metadata?.name}`}
            >
              {row.original.metadata?.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor('_kind', {
        id: 'kind',
        header: t('common.fields.kind'),
        filterFn: 'equalsString',
        cell: ({ getValue }) => (
          <Badge variant="outline" className="text-xs">
            {getValue()}
          </Badge>
        ),
      }),
      columnHelper.accessor('metadata.creationTimestamp', {
        id: 'created',
        header: t('common.fields.created'),
        cell: ({ getValue }) => (
          <span className="text-muted-foreground text-sm">
            {getValue() ? formatDate(getValue() as string) : '-'}
          </span>
        ),
      }),
    ],
    [t]
  )

  const {
    sorting,
    setSorting,
    columnFilters,
    setColumnFilters,
    searchQuery,
    setSearchQuery,
    debouncedSearchQuery,
    pagination,
    setPagination,
  } = useResourceTableState({
    resourceName: 'policies',
    clusterScope: true,
    defaultHiddenColumns: [],
  })

  const table = useReactTable<PolicyRow>({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    getRowId: (row) => `${row._resourceType}/${row.metadata?.name}`,
    globalFilterFn: (row, _columnId, value) =>
      policySearchFilter(row.original, String(value)),
    state: {
      sorting,
      columnFilters,
      globalFilter: debouncedSearchQuery,
      pagination,
    },
  })

  const emptyState =
    firstError && rows.length === 0 ? (
      <ErrorMessage
        resourceName={t('nav.policies')}
        error={firstError as Error}
        refetch={() => queries.forEach((query) => query.refetch())}
      />
    ) : !isLoading && rows.length === 0 ? (
      <div className="h-72 flex flex-col items-center justify-center">
        <h3 className="text-lg font-medium mb-1">{t('policies.empty')}</h3>
      </div>
    ) : null

  return (
    <div className="flex flex-col gap-3">
      {firstError && rows.length > 0 ? (
        <Alert variant="destructive">
          <AlertDescription>{t('policies.partialError')}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex items-center gap-2">
        <Input
          placeholder={t('policies.searchPlaceholder')}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="max-w-sm"
        />
        <Select
          value={(table.getColumn('kind')?.getFilterValue() as string) || 'all'}
          onValueChange={(value) =>
            table
              .getColumn('kind')
              ?.setFilterValue(value === 'all' ? undefined : value)
          }
        >
          <SelectTrigger className="w-64">
            <SelectValue placeholder={t('policies.allKinds')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('policies.allKinds')}</SelectItem>
            {POLICY_SOURCES.map((source) => (
              <SelectItem key={source.resourceType} value={source.kind}>
                {source.kind}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ResourceTableView
        table={table}
        columnCount={columns.length}
        isLoading={isLoading}
        data={rows}
        fitViewportHeight={true}
        emptyState={emptyState}
        hasActiveFilters={
          Boolean(debouncedSearchQuery) || columnFilters.length > 0
        }
        filteredRowCount={table.getFilteredRowModel().rows.length}
        totalRowCount={rows.length}
        searchQuery={debouncedSearchQuery}
        pagination={pagination}
        setPagination={setPagination}
      />
    </div>
  )
}
