import { lazy, Suspense } from 'react'

import { Card, CardContent } from '@/components/ui/card'

import type { TerminalProps } from './terminal-content'

const TerminalContent = lazy(async () => {
  const module = await import('./terminal-content')
  return { default: module.Terminal }
})

export function Terminal(props: TerminalProps) {
  return (
    <Suspense
      fallback={
        <Card className={props.embedded ? 'h-full border-0 shadow-none' : ''}>
          <CardContent
            className={`flex items-center justify-center text-sm text-muted-foreground ${
              props.embedded ? 'h-full min-h-0' : 'h-[400px]'
            }`}
          >
            Loading terminal...
          </CardContent>
        </Card>
      }
    >
      <TerminalContent {...props} />
    </Suspense>
  )
}
