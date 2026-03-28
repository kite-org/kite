import { useState } from 'react'
import { Pod } from 'kubernetes-types/core/v1'
import { Check, ChevronsUpDown } from 'lucide-react'

import { cn, getAge } from '@/lib/utils'
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

interface PodSelectorProps {
  pods: Pod[]
  selectedPod?: string
  onPodChange: (podName?: string) => void
  placeholder?: string
  showAllOption?: boolean
}

export function PodSelector({
  pods,
  selectedPod,
  onPodChange,
  showAllOption = false,
}: PodSelectorProps) {
  const [open, setOpen] = useState(false)

  const allOption: Pod = {
    metadata: {
      name: 'All Pods',
      uid: 'all',
      creationTimestamp: undefined,
    },
  }
  const options = showAllOption ? [allOption, ...pods] : pods

  const selectedOption = selectedPod
    ? pods.find((c) => c.metadata?.name === selectedPod)
    : allOption

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full min-w-0 justify-between md:w-auto md:max-w-[300px]"
        >
          <span className="truncate">
            {selectedOption ? selectedOption.metadata?.name : 'All'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] max-w-[min(300px,calc(100vw-1rem))] p-0">
        <Command>
          <CommandInput placeholder="Search pods..." />
          <CommandList>
            <CommandEmpty>No pods found.</CommandEmpty>
            <CommandGroup>
              {options.map((pod) => (
                <CommandItem
                  key={pod.metadata?.uid}
                  value={pod.metadata?.name}
                  onSelect={(currentValue) => {
                    const newValue =
                      currentValue === allOption.metadata?.name
                        ? undefined
                        : currentValue
                    onPodChange(newValue)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      selectedPod === pod.metadata?.name ||
                        (!selectedPod &&
                          pod.metadata?.name === allOption.metadata?.name)
                        ? 'opacity-100'
                        : 'opacity-0'
                    )}
                  />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {pod.metadata?.name}
                    </span>
                    {pod.metadata?.creationTimestamp && (
                      <span className="truncate text-xs text-muted-foreground">
                        Age: {getAge(pod.metadata?.creationTimestamp || '')},
                        Node: {pod.spec?.nodeName}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
