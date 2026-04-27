import {
  OverlayScrollbarsComponent,
  OverlayScrollbarsComponentProps,
  OverlayScrollbarsComponentRef,
} from 'overlayscrollbars-react'
import { forwardRef } from 'react'

import { cn } from '@/lib/utils'

const defaultOptions: OverlayScrollbarsComponentProps['options'] = {
  scrollbars: {
    autoHide: 'scroll',
    autoHideDelay: 800,
  },
}

interface ScrollAreaProps
  extends Omit<OverlayScrollbarsComponentProps, 'options' | 'children'> {
  children?: React.ReactNode
  options?: OverlayScrollbarsComponentProps['options']
}

export const ScrollArea = forwardRef<OverlayScrollbarsComponentRef<'div'>, ScrollAreaProps>(
  ({ children, options, className, style, ...props }, ref) => {
    return (
      <OverlayScrollbarsComponent
        ref={ref}
        options={{ ...defaultOptions, ...options }}
        className={cn('h-full', className)}
        style={style}
        {...props}
      >
        {children}
      </OverlayScrollbarsComponent>
    )
  },
)

ScrollArea.displayName = 'ScrollArea'
