import { useMemo } from 'react'

import { ResourceType } from '@/types/api'
import { useResources } from '@/lib/api'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface ResourceSelectProps {
  resourceType: ResourceType
  value?: string
  onChange: (value: string) => void
  namespace?: string
  placeholder?: string
  className?: string
  filter?: (item: { metadata?: { name?: string }; type?: string }) => boolean
}

export function ResourceSelect({
  resourceType,
  value,
  onChange,
  namespace,
  placeholder = `Select a ${resourceType.slice(0, -1)}`,
  className,
  filter,
}: ResourceSelectProps) {
  const { data, isLoading } = useResources(resourceType, namespace)

  const sorted = useMemo(() => {
    const items = data?.slice() ?? []
    const filtered = filter ? items.filter(filter) : items
    return filtered.sort((a, b) => {
      const nameA = a.metadata?.name?.toLowerCase() || ''
      const nameB = b.metadata?.name?.toLowerCase() || ''
      return nameA.localeCompare(nameB)
    })
  }, [data, filter])

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {isLoading && (
          <SelectItem disabled value="_loading">
            Loading {resourceType}...
          </SelectItem>
        )}
        {sorted.map((item) => (
          <SelectItem key={item.metadata!.name} value={item.metadata!.name!}>
            {item.metadata!.name}
          </SelectItem>
        ))}
        {!isLoading && sorted.length === 0 && (
          <SelectItem disabled value="_empty">
            No {resourceType} found
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  )
}
