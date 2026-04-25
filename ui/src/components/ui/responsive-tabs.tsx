'use client'

import { useSearchParams } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface TabItem {
  value: string
  label: React.ReactNode
  content: React.ReactNode
}

interface ResponsiveTabsProps {
  tabs: TabItem[]
  className?: string
  stickyHeader?: React.ReactNode
  stickyHeaderClassName?: string
  tabsListClassName?: string
}

export function ResponsiveTabs({
  tabs,
  className,
  stickyHeader,
  stickyHeaderClassName,
  tabsListClassName,
}: ResponsiveTabsProps) {
  const isMobile = useIsMobile()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const value = tabs.some((tab) => tab.value === tabParam)
    ? tabParam!
    : tabs[0]?.value || ''

  const handleValueChange = (nextValue: string) => {
    setSearchParams(
      (prev) => {
        const nextParams = new URLSearchParams(prev)
        nextParams.set('tab', nextValue)
        return nextParams
      },
      { replace: true }
    )
  }

  const currentTab = tabs.find((tab) => tab.value === value)

  if (isMobile) {
    return (
      <div className={cn('space-y-4', className)}>
        <div className={stickyHeaderClassName}>
          {stickyHeader}
          <Select value={value} onValueChange={handleValueChange}>
            <SelectTrigger className="w-full">
              <SelectValue>{currentTab?.label || 'Select tab'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {tabs.map((tab) => (
                <SelectItem key={tab.value} value={tab.value}>
                  {tab.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {currentTab && <div className="space-y-4">{currentTab.content}</div>}
      </div>
    )
  }

  return (
    <Tabs
      value={value}
      onValueChange={handleValueChange}
      className={className}
    >
      <div className={stickyHeaderClassName}>
        {stickyHeader}
        <TabsList
          className={cn(
            'min-h-11 h-auto w-full flex-wrap justify-start gap-x-4 gap-y-0 overflow-x-visible rounded-none border-b bg-transparent p-0 text-muted-foreground',
            '**:data-[slot=tabs-trigger]:h-11 **:data-[slot=tabs-trigger]:flex-none **:data-[slot=tabs-trigger]:rounded-none **:data-[slot=tabs-trigger]:border-0 **:data-[slot=tabs-trigger]:border-b-2 **:data-[slot=tabs-trigger]:border-transparent **:data-[slot=tabs-trigger]:bg-transparent **:data-[slot=tabs-trigger]:px-0 **:data-[slot=tabs-trigger]:py-0 **:data-[slot=tabs-trigger]:text-muted-foreground **:data-[slot=tabs-trigger]:shadow-none **:data-[slot=tabs-trigger]:transition-colors **:data-[slot=tabs-trigger]:hover:text-foreground **:data-[slot=tabs-trigger]:data-[state=active]:border-primary **:data-[slot=tabs-trigger]:data-[state=active]:bg-transparent **:data-[slot=tabs-trigger]:data-[state=active]:text-primary **:data-[slot=tabs-trigger]:data-[state=active]:shadow-none',
            '**:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:border-transparent **:data-[slot=badge]:bg-muted-foreground/20 **:data-[slot=badge]:px-1 **:data-[slot=badge]:text-muted-foreground',
            tabsListClassName
          )}
        >
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="space-y-4">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
