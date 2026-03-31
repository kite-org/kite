import { useCallback, useMemo, useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import * as yaml from 'js-yaml'
import { CustomResourceDefinition } from 'kubernetes-types/apiextensions/v1'
import { Eye } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { CustomResource, ResourceType } from '@/types/api'
import { useResource } from '@/lib/api'
import { getPrinterColumnValue } from '@/lib/k8s'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ResourceTable } from '@/components/resource-table'
import { YamlEditor } from '@/components/yaml-editor'

export function CRListPage() {
  const [isYamlDialogOpen, setIsYamlDialogOpen] = useState(false)
  const [yamlContent, setYamlContent] = useState('')
  const { crd } = useParams<{ crd: string }>()
  const { data: crdData, isLoading: isLoadingCRD } = useResource('crds', crd!)

  const columnHelper = createColumnHelper<CustomResource>()
  const handleViewYaml = useCallback((crd: CustomResourceDefinition) => {
    setYamlContent(yaml.dump(crd, { indent: 2 }))
    setIsYamlDialogOpen(true)
  }, [])
  const extraToolbars = useMemo(() => {
    return [
      <Button
        variant="outline"
        size="default"
        onClick={() => {
          handleViewYaml(crdData as CustomResourceDefinition)
        }}
      >
        <Eye className="h-4 w-4 mr-1" />
        View YAML
      </Button>,
    ]
  }, [crdData, handleViewYaml])
  const columns = useMemo(() => {
    const baseColumns = [
      columnHelper.accessor('metadata.name', {
        header: 'Name',
        cell: ({ row }) => {
          const resource = row.original
          const namespace = resource.metadata?.namespace
          const path = namespace
            ? `/crds/${crd}/${namespace}/${resource.metadata.name}`
            : `/crds/${crd}/${resource.metadata.name}`

          return (
            <div className="font-medium app-link">
              <Link to={path}>{resource.metadata.name}</Link>
            </div>
          )
        },
      }),
    ]
    const additionalColumns =
      crdData?.spec.versions[0].additionalPrinterColumns?.map(
        (printerColumn) => {
          const jsonPath = printerColumn.jsonPath

          return columnHelper.accessor(
            (row) => getPrinterColumnValue(row, jsonPath),
            {
              id: jsonPath || printerColumn.name,
              header: printerColumn.name,
              cell: ({ getValue }) => {
                const type = printerColumn.type
                const value = getValue()
                if (!value) {
                  return (
                    <span className="text-sm text-muted-foreground">-</span>
                  )
                }
                if (type === 'date') {
                  return (
                    <span className="text-sm text-muted-foreground">
                      {formatDate(value)}
                    </span>
                  )
                }
                return (
                  <span className="text-sm text-muted-foreground">{value}</span>
                )
              },
            }
          )
        }
      )
    return [...baseColumns, ...(additionalColumns ?? [])]
  }, [columnHelper, crd, crdData?.spec.versions])

  const searchQueryFilter = useCallback((cr: CustomResource, query: string) => {
    const searchFields = [
      cr.metadata?.name || '',
      cr.metadata?.namespace || '',
      cr.kind || '',
      cr.apiVersion || '',
      ...(cr.metadata?.labels ? Object.keys(cr.metadata.labels) : []),
      ...(cr.metadata?.labels ? Object.values(cr.metadata.labels) : []),
    ]

    return searchFields.some((field) =>
      field.toLowerCase().includes(query.toLowerCase())
    )
  }, [])

  if (isLoadingCRD) {
    return <div>Loading...</div>
  }

  if (!crdData) {
    return <div>Error: CRD name is required</div>
  }

  return (
    <>
      <ResourceTable
        resourceName={crdData.spec.names.kind || 'Custom Resources'}
        resourceType={crd as ResourceType}
        columns={columns}
        clusterScope={crdData.spec.scope === 'Cluster'}
        searchQueryFilter={searchQueryFilter}
        extraToolbars={extraToolbars}
      />

      <Dialog open={isYamlDialogOpen} onOpenChange={setIsYamlDialogOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              YAML Configuration: {crdData?.metadata?.name ?? 'Unknown'}
            </DialogTitle>
          </DialogHeader>
          <YamlEditor
            value={yamlContent}
            readOnly={true}
            showControls={false}
            minHeight={600}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
