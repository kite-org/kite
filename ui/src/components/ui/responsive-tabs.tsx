'use client'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
} from 'react'
import { Eye, EyeOff, GripVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { Button } from '@/components/ui/button'
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
  contentClassName?: string
  tabsListClassName?: string
  customizationKey?: string
}

const LONG_PRESS_MS = 1400

interface TabCustomization {
  order: string[]
  hidden: string[]
}

export function ResponsiveTabs({
  tabs,
  className,
  stickyHeader,
  stickyHeaderClassName,
  contentClassName,
  tabsListClassName,
  customizationKey,
}: ResponsiveTabsProps) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const [searchParams, setSearchParams] = useSearchParams()
  const [isCustomizing, setIsCustomizing] = useState(false)
  const [customization, setCustomization] = useState<TabCustomization>({
    order: [],
    hidden: [],
  })
  const [draggedTabValue, setDraggedTabValue] = useState<string | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const storageKey = customizationKey
    ? `kite:responsive-tabs:${customizationKey}`
    : ''

  useEffect(() => {
    if (!storageKey) {
      setCustomization({ order: [], hidden: [] })
      return
    }

    const storedCustomization = window.localStorage.getItem(storageKey)

    if (!storedCustomization) {
      setCustomization({ order: [], hidden: [] })
      return
    }

    try {
      const parsed = JSON.parse(storedCustomization) as Partial<TabCustomization>
      setCustomization({
        order: Array.isArray(parsed.order) ? parsed.order : [],
        hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      })
    } catch {
      setCustomization({ order: [], hidden: [] })
    }
  }, [storageKey])

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
      }
    }
  }, [])

  const orderedTabs = useMemo(() => {
    const tabByValue = new Map(tabs.map((tab) => [tab.value, tab]))
    const storedTabs = customization.order
      .map((tabValue) => tabByValue.get(tabValue))
      .filter((tab): tab is TabItem => Boolean(tab))
    const storedValues = new Set(storedTabs.map((tab) => tab.value))

    return [
      ...storedTabs,
      ...tabs.filter((tab) => !storedValues.has(tab.value)),
    ]
  }, [customization.order, tabs])

  const hiddenValues = useMemo(
    () => new Set(customization.hidden),
    [customization.hidden]
  )
  const visibleTabs = useMemo(() => {
    const nextTabs = orderedTabs.filter((tab) => !hiddenValues.has(tab.value))
    return nextTabs.length ? nextTabs : orderedTabs.slice(0, 1)
  }, [hiddenValues, orderedTabs])

  const tabParam = searchParams.get('tab')
  const value = visibleTabs.some((tab) => tab.value === tabParam)
    ? tabParam!
    : visibleTabs[0]?.value || ''

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

  const saveCustomization = (nextCustomization: TabCustomization) => {
    setCustomization(nextCustomization)

    if (storageKey) {
      window.localStorage.setItem(storageKey, JSON.stringify(nextCustomization))
    }
  }

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handleTabsPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!customizationKey || isCustomizing || event.button !== 0) {
      return
    }

    clearLongPressTimer()
    longPressTimerRef.current = setTimeout(() => {
      setIsCustomizing(true)
    }, LONG_PRESS_MS)
  }

  const toggleTabVisibility = (tabValue: string) => {
    const hidden = hiddenValues.has(tabValue)
      ? customization.hidden.filter((value) => value !== tabValue)
      : [...customization.hidden, tabValue]

    saveCustomization({
      order: orderedTabs.map((tab) => tab.value),
      hidden,
    })

    if (tabValue === value && hidden.includes(tabValue)) {
      const nextTab = orderedTabs.find((tab) => !hidden.includes(tab.value))
      if (nextTab) {
        handleValueChange(nextTab.value)
      }
    }
  }

  const handleTabDragStart = (
    event: DragEvent<HTMLDivElement>,
    tabValue: string
  ) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', tabValue)
    setDraggedTabValue(tabValue)
  }

  const handleTabDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggedTabValue) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  const handleTabDrop = (
    event: DragEvent<HTMLDivElement>,
    targetValue: string
  ) => {
    event.preventDefault()

    const sourceValue =
      event.dataTransfer.getData('text/plain') || draggedTabValue

    if (!sourceValue || sourceValue === targetValue) {
      setDraggedTabValue(null)
      return
    }

    const nextOrder = orderedTabs.map((tab) => tab.value)
    const sourceIndex = nextOrder.indexOf(sourceValue)
    const targetIndex = nextOrder.indexOf(targetValue)

    if (sourceIndex === -1 || targetIndex === -1) {
      setDraggedTabValue(null)
      return
    }

    const targetRect = event.currentTarget.getBoundingClientRect()
    const insertIndex =
      targetIndex +
      (event.clientX > targetRect.left + targetRect.width / 2 ? 1 : 0)
    const [movedValue] = nextOrder.splice(sourceIndex, 1)
    nextOrder.splice(
      sourceIndex < insertIndex ? insertIndex - 1 : insertIndex,
      0,
      movedValue
    )

    saveCustomization({
      order: nextOrder,
      hidden: customization.hidden,
    })
    setDraggedTabValue(null)
  }

  const currentTab = visibleTabs.find((tab) => tab.value === value)
  const visibleTabCount = orderedTabs.filter(
    (tab) => !hiddenValues.has(tab.value)
  ).length

  if (isMobile) {
    return (
      <div className={cn('flex min-h-0 flex-col gap-4', className)}>
        <div className={cn('shrink-0', stickyHeaderClassName)}>
          {stickyHeader}
          <Select value={value} onValueChange={handleValueChange}>
            <SelectTrigger className="w-full">
              <SelectValue>{currentTab?.label || 'Select tab'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {visibleTabs.map((tab) => (
                <SelectItem key={tab.value} value={tab.value}>
                  {tab.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {currentTab && (
          <div className={cn('min-h-0 flex-1', contentClassName)}>
            {currentTab.content}
          </div>
        )}
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
        {isCustomizing ? (
          <div
            className={cn(
              'flex min-h-11 h-auto w-full flex-wrap justify-start gap-x-4 gap-y-0 overflow-x-visible rounded-none border-b bg-transparent p-0 text-muted-foreground',
              '**:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:border-transparent **:data-[slot=badge]:bg-muted-foreground/20 **:data-[slot=badge]:px-1 **:data-[slot=badge]:text-muted-foreground',
              tabsListClassName
            )}
            role="list"
          >
            {orderedTabs.map((tab) => {
              const isHidden = hiddenValues.has(tab.value)
              return (
                <div
                  key={tab.value}
                  draggable
                  onDragStart={(event) =>
                    handleTabDragStart(event, tab.value)
                  }
                  onDragOver={handleTabDragOver}
                  onDrop={(event) => handleTabDrop(event, tab.value)}
                  onDragEnd={() => setDraggedTabValue(null)}
                  className={cn(
                    'flex h-11 flex-none cursor-grab items-center gap-1 border-b-2 border-transparent px-0 py-0 text-sm font-medium whitespace-nowrap',
                    tab.value === value &&
                      !isHidden &&
                      'border-primary text-primary',
                    isHidden && 'text-muted-foreground/50'
                  )}
                  role="listitem"
                >
                  <GripVertical className="size-4" aria-hidden="true" />
                  <span
                    className={cn(
                      'min-w-0 truncate',
                      isHidden && 'line-through'
                    )}
                  >
                    {tab.label}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={
                      isHidden
                        ? t('common.actions.show')
                        : t('common.actions.hide')
                    }
                    disabled={!isHidden && visibleTabCount <= 1}
                    onClick={() => toggleTabVisibility(tab.value)}
                  >
                    {isHidden ? (
                      <Eye className="size-4" />
                    ) : (
                      <EyeOff className="size-4" />
                    )}
                  </Button>
                </div>
              )
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto self-center"
              onClick={() => setIsCustomizing(false)}
            >
              {t('common.actions.done')}
            </Button>
          </div>
        ) : (
          <TabsList
            className={cn(
              'min-h-11 h-auto w-full flex-wrap justify-start gap-x-4 gap-y-0 overflow-x-visible rounded-none border-b bg-transparent p-0 text-muted-foreground',
              '**:data-[slot=tabs-trigger]:h-11 **:data-[slot=tabs-trigger]:flex-none **:data-[slot=tabs-trigger]:rounded-none **:data-[slot=tabs-trigger]:border-0 **:data-[slot=tabs-trigger]:border-b-2 **:data-[slot=tabs-trigger]:border-transparent **:data-[slot=tabs-trigger]:bg-transparent **:data-[slot=tabs-trigger]:px-0 **:data-[slot=tabs-trigger]:py-0 **:data-[slot=tabs-trigger]:text-muted-foreground **:data-[slot=tabs-trigger]:shadow-none **:data-[slot=tabs-trigger]:transition-colors **:data-[slot=tabs-trigger]:hover:text-foreground **:data-[slot=tabs-trigger]:data-[state=active]:border-primary **:data-[slot=tabs-trigger]:data-[state=active]:bg-transparent **:data-[slot=tabs-trigger]:data-[state=active]:text-primary **:data-[slot=tabs-trigger]:data-[state=active]:shadow-none',
              '**:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:border-transparent **:data-[slot=badge]:bg-muted-foreground/20 **:data-[slot=badge]:px-1 **:data-[slot=badge]:text-muted-foreground',
              tabsListClassName
            )}
            onPointerDown={handleTabsPointerDown}
            onPointerUp={clearLongPressTimer}
            onPointerCancel={clearLongPressTimer}
            onPointerLeave={clearLongPressTimer}
          >
            {visibleTabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="dark:data-[state=active]:border-primary dark:data-[state=active]:bg-transparent dark:data-[state=active]:text-primary"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
      </div>

      {visibleTabs.map((tab) => (
        <TabsContent
          key={tab.value}
          value={tab.value}
          className={cn('space-y-4', contentClassName)}
        >
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
