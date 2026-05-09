import { useMemo, useState } from 'react'
import { Namespace } from 'kubernetes-types/core/v1'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'

import { useResources } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

export function NamespaceSelector({
  selectedNamespace,
  handleNamespaceChange,
  showAll = false,
  disabled = false,
  triggerClassName,
  multiple = false,
}: {
  selectedNamespace?: string
  handleNamespaceChange: (namespace: string) => void
  showAll?: boolean
  disabled?: boolean
  triggerClassName?: string
  multiple?: boolean
}) {
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useResources('namespaces')
  const selectedNamespaces = useMemo(() => {
    if (!selectedNamespace || selectedNamespace === '_all') return []
    return selectedNamespace.split(',').filter(Boolean)
  }, [selectedNamespace])

  const sortedNamespaces = useMemo(() => {
    if (!data) return []
    return [...data].sort((a, b) => {
      const nameA = a.metadata?.name?.toLowerCase() || ''
      const nameB = b.metadata?.name?.toLowerCase() || ''
      return nameA.localeCompare(nameB)
    })
  }, [data])

  const triggerLabel =
    selectedNamespace === '_all'
      ? 'All Namespaces'
      : multiple && selectedNamespaces.length > 1
        ? `${selectedNamespaces.length} Namespaces`
        : selectedNamespace || `Select namespace${multiple ? 's' : ''}...`

  const selectNamespace = (namespace: string) => {
    handleNamespaceChange(namespace)
    setOpen(false)
  }

  const toggleNamespace = (namespace: string) => {
    if (selectedNamespace === '_all') {
      handleNamespaceChange(namespace)
      return
    }

    const nextNamespaces = selectedNamespaces.includes(namespace)
      ? selectedNamespaces.filter((name) => name !== namespace)
      : [...selectedNamespaces, namespace]

    handleNamespaceChange(
      nextNamespaces.length > 0 ? nextNamespaces.join(',') : '_all'
    )
  }

  const handleNamespaceSelect = (namespace: string) => {
    if (multiple && selectedNamespaces.length >= 2) {
      toggleNamespace(namespace)
      return
    }

    selectNamespace(namespace)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full min-w-0 justify-between sm:w-auto sm:min-w-[9rem] sm:max-w-[14rem]',
            triggerClassName
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[max(var(--radix-popover-trigger-width),18rem)] max-w-[min(300px,calc(100vw-1rem))] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search..." className="h-9" />
          <CommandList className="max-h-[300px] overflow-x-hidden overflow-y-auto [ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {isLoading ? (
              <div className="flex items-center justify-center p-6 text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading...
              </div>
            ) : (
              <>
                <CommandEmpty>No results.</CommandEmpty>
                <CommandGroup>
                  {showAll && (
                    <CommandItem
                      value="_all"
                      onSelect={() => {
                        handleNamespaceChange('_all')
                        setOpen(false)
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4 shrink-0',
                          selectedNamespace === '_all'
                            ? 'opacity-100'
                            : 'opacity-0'
                        )}
                      />
                      <span className="truncate">All Namespaces</span>
                    </CommandItem>
                  )}

                  {sortedNamespaces.map((ns: Namespace) => {
                    const name = ns.metadata?.name || ''
                    const selected = multiple
                      ? selectedNamespaces.includes(name)
                      : selectedNamespace === name

                    return (
                      <CommandItem
                        key={name}
                        value={name}
                        onSelect={() => handleNamespaceSelect(name)}
                        className="flex items-center"
                      >
                        {multiple ? (
                          <Checkbox
                            checked={selected}
                            onCheckedChange={() => toggleNamespace(name)}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                            aria-label={`Toggle namespace ${name}`}
                            className="mr-2"
                          />
                        ) : (
                          <Check
                            className={cn(
                              'mr-2 h-4 w-4 shrink-0',
                              selected ? 'opacity-100' : 'opacity-0'
                            )}
                          />
                        )}
                        <span className="truncate flex-1 min-w-0" title={name}>
                          {name}
                        </span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
