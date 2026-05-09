import { useState } from 'react'
import { Package } from 'lucide-react'

import { cn } from '@/lib/utils'

export function HelmChartIcon({
  icon,
  name,
  className,
}: {
  icon?: string
  name: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  if (icon && !failed) {
    return (
      <img
        src={icon}
        alt={name}
        className={cn(
          'size-9 rounded-md border bg-background object-contain',
          className
        )}
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex size-9 items-center justify-center rounded-md border bg-muted text-muted-foreground',
        className
      )}
      role="img"
      aria-label={name}
    >
      <Package className="size-4" />
    </div>
  )
}
