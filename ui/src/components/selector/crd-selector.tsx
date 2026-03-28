import { useMemo, useState } from 'react'
import { CustomResourceDefinition } from 'kubernetes-types/apiextensions/v1'
import { Check, ChevronsUpDown } from 'lucide-react'

import { useResources } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface CRDSelectorProps {
  selectedCRD?: string
  onCRDChange: (crdName: string, kind: string) => void
  placeholder?: string
  disabled?: boolean
}

type CRDOption = {
  name: string
  kind: string
  group: string
  scope: string
  versions: string
}

export function CRDSelector({
  selectedCRD,
  onCRDChange,
  placeholder = 'Select CRD...',
  disabled = false,
}: CRDSelectorProps) {
  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const {
    data: crdsData,
    isLoading: crdsLoading,
    error: crdsError,
  } = useResources('crds', undefined, { disable: !open })

  const availableCRDs = useMemo<CRDOption[]>(() => {
    if (!crdsData) return []
    return (crdsData as CustomResourceDefinition[])
      .map((crd) => ({
        name: crd.metadata?.name || '',
        kind: crd.spec?.names?.kind || '',
        group: crd.spec?.group || '',
        scope: crd.spec?.scope || 'Namespaced',
        versions: crd.spec?.versions?.map((v) => v.name).join(', ') || '',
      }))
      .filter((crd) => crd.name)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [crdsData])

  const crdGroups = useMemo<Record<string, CRDOption[]>>(() => {
    const groups: Record<string, CRDOption[]> = {}
    availableCRDs.forEach((crd) => {
      const group = crd.group || 'core'
      if (!groups[group]) groups[group] = []
      groups[group].push(crd)
    })
    return groups
  }, [availableCRDs])

  const filteredCRDGroups = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) return crdGroups

    return Object.entries(crdGroups).reduce(
      (acc, [groupName, crds]) => {
        const filtered = crds.filter((crd) => {
          const haystack = `${crd.name} ${crd.kind} ${crd.group}`.toLowerCase()
          return haystack.includes(query)
        })
        if (filtered.length) {
          acc[groupName] = filtered
        }
        return acc
      },
      {} as Record<string, CRDOption[]>
    )
  }, [crdGroups, searchTerm])

  const selectedCRDData = availableCRDs.find((crd) => crd.name === selectedCRD)

  if (crdsLoading) {
    return (
      <Button variant="outline" disabled className="justify-between">
        Loading CRDs...
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
    )
  }

  if (crdsError) {
    return (
      <Button variant="outline" disabled className="justify-between">
        Failed to load CRDs
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
    )
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          setSearchTerm('')
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full min-w-0 justify-between md:w-auto md:min-w-[200px]"
        >
          <span
            className={`truncate ${
              selectedCRD ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            {selectedCRDData ? selectedCRDData.name : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[calc(100vw-1rem)] max-w-[400px] p-0 md:w-[400px]">
        <div className="p-2 border-b">
          <Input
            placeholder="Search CRDs..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            autoFocus
          />
        </div>
        <div
          className="max-h-[300px] overflow-y-auto"
          onWheelCapture={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
        >
          {Object.keys(filteredCRDGroups).length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No CRDs found.
            </div>
          ) : (
            Object.entries(filteredCRDGroups).map(([groupName, crds]) => (
              <div key={groupName}>
                <div className="px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
                  {groupName}
                </div>
                <div className="pb-2">
                  {crds.map((crd) => {
                    const isSelected = selectedCRD === crd.name
                    return (
                      <button
                        key={crd.name}
                        type="button"
                        className={cn(
                          'flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none',
                          isSelected && 'bg-muted'
                        )}
                        onClick={() => {
                          onCRDChange(crd.name, crd.kind)
                          setOpen(false)
                        }}
                      >
                        <Check
                          className={cn(
                            'mt-0.5 h-4 w-4 shrink-0',
                            isSelected ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <div className="flex flex-col">
                          <span className="font-medium">{crd.kind}</span>
                          <span className="text-xs text-muted-foreground">
                            {crd.name}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
