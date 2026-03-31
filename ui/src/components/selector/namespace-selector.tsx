import { useMemo, useState } from 'react'
import { Namespace } from 'kubernetes-types/core/v1'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'

import { useResources } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
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
}: {
  selectedNamespace?: string
  handleNamespaceChange: (namespace: string) => void
  showAll?: boolean
}) {
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useResources('namespaces')

  const sortedNamespaces = useMemo(() => {
    if (!data) return []
    return [...data].sort((a, b) => {
      const nameA = a.metadata?.name?.toLowerCase() || ''
      const nameB = b.metadata?.name?.toLowerCase() || ''
      return nameA.localeCompare(nameB)
    })
  }, [data])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full min-w-0 justify-between sm:w-auto sm:min-w-[9rem] sm:max-w-[14rem]"
        >
          <span className="truncate">
            {selectedNamespace === '_all'
              ? 'All Namespaces'
              : selectedNamespace || 'Select namespace...'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[max(var(--radix-popover-trigger-width),14rem)] max-w-[calc(100vw-1rem)] p-0"
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
                    return (
                      <CommandItem
                        key={name}
                        value={name}
                        onSelect={(val) => {
                          handleNamespaceChange(val)
                          setOpen(false)
                        }}
                        className="flex items-center"
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4 shrink-0',
                            selectedNamespace === name
                              ? 'opacity-100'
                              : 'opacity-0'
                          )}
                        />
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
