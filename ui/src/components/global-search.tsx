import {
  ComponentType,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAuth } from '@/contexts/auth-context'
import { useSidebarConfig } from '@/contexts/sidebar-config-context'
import {
  IconLayoutDashboard,
  IconMoon,
  IconServer,
  IconSettings,
  IconStar,
  IconStarFilled,
  IconSun,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { globalSearch, SearchResult } from '@/lib/api'
import {
  getResourceCatalogEntry,
  getResourceIconComponent,
} from '@/lib/resource-catalog'
import { useCluster } from '@/hooks/use-cluster'
import { useFavorites } from '@/hooks/use-favorites'
import { Badge } from '@/components/ui/badge'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppearance } from '@/components/appearance-provider'

interface SidebarSearchItem {
  id: string
  title: string
  url: string
  Icon: ComponentType<{ className?: string }>
  groupLabel?: string
  searchText: string
  isPinned: boolean
}

interface ActionSearchItem {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  searchText: string
  onSelect: () => void
}

interface GlobalSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

let cachedSearchResults: SearchResult[] = []
const cachedSearchResultsByQuery = new Map<string, SearchResult[]>()

function normalizeCachedSearchQuery(query: string) {
  return query.trim().toLowerCase()
}

function cacheSearchResults(query: string, results: SearchResult[]) {
  const key = normalizeCachedSearchQuery(query)
  if (!key) {
    return
  }

  cachedSearchResultsByQuery.set(key, results)
  cachedSearchResults = results
  if (cachedSearchResultsByQuery.size > 30) {
    const oldestKey = cachedSearchResultsByQuery.keys().next().value
    if (oldestKey) {
      cachedSearchResultsByQuery.delete(oldestKey)
    }
  }
}

function getCachedPrefixResults(query: string) {
  const key = normalizeCachedSearchQuery(query)
  let bestKey = ''
  let bestResults: SearchResult[] | undefined

  for (const [cachedQuery, results] of cachedSearchResultsByQuery) {
    if (key.startsWith(cachedQuery) && cachedQuery.length > bestKey.length) {
      bestKey = cachedQuery
      bestResults = results
    }
  }

  return bestResults
}

export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>(
    () => cachedSearchResults || []
  )
  const [lastSearchResults, setLastSearchResults] = useState<SearchResult[]>(
    () => cachedSearchResults || []
  )
  const [isLoading, setIsLoading] = useState(false)
  const searchRequestIdRef = useRef(0)
  const mountedRef = useRef(true)
  const navigate = useNavigate()
  const { user } = useAuth()
  const { config, getIconComponent } = useSidebarConfig()
  const { setTheme, actualTheme } = useAppearance()
  const {
    clusters,
    currentCluster,
    setCurrentCluster,
    isSwitching,
    isLoading: isClusterLoading,
  } = useCluster()

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      searchRequestIdRef.current += 1
    }
  }, [])

  // Simple theme toggle function
  const toggleTheme = useCallback(() => {
    if (actualTheme === 'dark') {
      setTheme('light')
    } else {
      setTheme('dark')
    }
  }, [actualTheme, setTheme])

  const sidebarItems = useMemo<SidebarSearchItem[]>(() => {
    const overviewTitle = t('nav.overview')
    const items: SidebarSearchItem[] = [
      {
        id: 'sidebar-overview',
        title: overviewTitle,
        url: '/',
        Icon: IconLayoutDashboard,
        groupLabel: undefined,
        searchText: `${overviewTitle} overview dashboard /`.toLowerCase(),
        isPinned: false,
      },
      ...(user?.isAdmin()
        ? [
            {
              id: 'settings',
              title: t('settings.title', 'Settings'),
              url: '/settings',
              Icon: IconSettings,
              groupLabel: 'Settings',
              searchText:
                `${t('settings.title', 'Settings')} admin`.toLowerCase(),
              isPinned: false,
            },
            {
              id: 'clusters',
              title: t('settings.tabs.clusters', 'Cluster'),
              url: '/settings?tab=clusters',
              Icon: IconSettings,
              groupLabel: 'Settings',
              searchText:
                `${t('settings.tabs.clusters', 'Cluster')} settings cluster admin`.toLowerCase(),
              isPinned: false,
            },
            {
              id: 'oauth',
              title: t('settings.tabs.oauth', 'Authentication'),
              url: '/settings?tab=oauth',
              Icon: IconSettings,
              groupLabel: 'Settings',
              searchText:
                `${t('settings.tabs.oauth', 'Authentication')} settings authentication ldap oauth admin`.toLowerCase(),
              isPinned: false,
            },
            {
              id: 'rbac',
              title: t('settings.tabs.rbac', 'RBAC'),
              url: '/settings?tab=rbac',
              Icon: IconSettings,
              groupLabel: 'Settings',
              searchText:
                `${t('settings.tabs.rbac', 'RBAC')} settings rbac admin`.toLowerCase(),
              isPinned: false,
            },
            {
              id: 'users',
              title: t('settings.tabs.users', 'User'),
              url: '/settings?tab=users',
              Icon: IconSettings,
              groupLabel: 'Settings',
              searchText:
                `${t('settings.tabs.users', 'User')} settings user admin`.toLowerCase(),
              isPinned: false,
            },
          ]
        : []),
    ]

    if (!config) {
      return items
    }

    const pinnedItems = new Set(config.pinnedItems)

    config.groups.forEach((group) => {
      const groupLabel = group.nameKey
        ? t(group.nameKey, { defaultValue: group.nameKey })
        : ''

      group.items
        .slice()
        .sort((a, b) => a.order - b.order)
        .forEach((item) => {
          const title = item.titleKey
            ? t(item.titleKey, { defaultValue: item.titleKey })
            : item.id
          const Icon = getIconComponent(item.icon) as ComponentType<{
            className?: string | undefined
          }>
          const searchTerms = [title, groupLabel, item.url, item.titleKey]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()

          items.push({
            id: item.id,
            title,
            url: item.url,
            Icon,
            groupLabel,
            searchText: searchTerms,
            isPinned: pinnedItems.has(item.id),
          })
        })
    })

    return items
  }, [config, getIconComponent, t, user])

  const sidebarResults = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase()
    if (!trimmedQuery) {
      return []
    }

    return sidebarItems
      .filter((item) => item.searchText.includes(trimmedQuery))
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) {
          return a.isPinned ? -1 : 1
        }
        return a.title.localeCompare(b.title)
      })
  }, [query, sidebarItems])

  const actionItems: ActionSearchItem[] = useMemo(() => {
    return [
      {
        id: 'toggle-theme',
        label: t('globalSearch.toggleTheme'),
        icon: actualTheme === 'dark' ? IconSun : IconMoon,
        searchText: 'toggle theme switch mode light dark'.toLocaleLowerCase(),
        onSelect: toggleTheme,
      },
      ...(clusters.length > 1
        ? clusters
            .filter((cluster) => cluster.name !== currentCluster)
            .map((cluster) => ({
              id: `switch-cluster-${cluster.name}`,
              label: t('globalSearch.switchCluster', { name: cluster.name }),
              icon: IconServer,
              searchText: `cluster ${cluster.name}`.toLocaleLowerCase(),
              onSelect: () => {
                if (
                  isSwitching ||
                  isClusterLoading ||
                  cluster.name === currentCluster
                ) {
                  return
                }
                setCurrentCluster(cluster.name)
              },
            }))
        : []),
    ]
  }, [
    actualTheme,
    clusters,
    currentCluster,
    isClusterLoading,
    isSwitching,
    setCurrentCluster,
    t,
    toggleTheme,
  ])

  // Filter theme option based on query
  const actionResults = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase()
    if (!trimmedQuery) {
      return []
    }

    return actionItems.filter((item) => item.searchText.includes(trimmedQuery))
  }, [actionItems, query])

  // Use favorites hook
  const {
    favorites,
    isFavorite,
    toggleFavorite: toggleResourceFavorite,
  } = useFavorites()

  const toggleFavorite = useCallback(
    (result: SearchResult, event: React.MouseEvent) => {
      event.stopPropagation()
      toggleResourceFavorite(result)
    },
    [toggleResourceFavorite]
  )

  const filterResults = useCallback(
    (items: SearchResult[], searchQuery: string) => {
      const terms = searchQuery
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)

      if (terms.length === 0) {
        return items
      }

      return items.filter((item) => {
        const haystack = `${item.name} ${item.namespace || ''} ${
          item.resourceType
        }`.toLowerCase()
        return terms.every((term) => haystack.includes(term))
      })
    },
    []
  )

  useEffect(() => {
    const searchQuery = query.trim()
    const favoriteResults = favorites || []
    const previousResults = lastSearchResults || []
    const prefixResults = getCachedPrefixResults(searchQuery)
    if (!searchQuery) {
      setResults(favoriteResults.length > 0 ? favoriteResults : previousResults)
      return
    }

    const cachedResults =
      prefixResults ??
      (previousResults.length > 0
        ? previousResults
        : favoriteResults.length > 0
          ? favoriteResults
          : undefined)

    setResults((currentResults) =>
      filterResults(cachedResults || currentResults, searchQuery)
    )
  }, [favorites, filterResults, lastSearchResults, query])

  const performSearch = useCallback(
    async (searchQuery: string, requestId: number) => {
      try {
        const response = await globalSearch(searchQuery, { limit: 10 })
        if (!mountedRef.current || searchRequestIdRef.current !== requestId) {
          return
        }
        const nextResults = response.results || []
        cacheSearchResults(searchQuery, nextResults)
        setLastSearchResults(nextResults)
        setResults(nextResults)
      } catch (error) {
        if (mountedRef.current && searchRequestIdRef.current === requestId) {
          console.error('Search failed:', error)
        }
      } finally {
        if (mountedRef.current && searchRequestIdRef.current === requestId) {
          setIsLoading(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    const searchQuery = query.trim()
    if (!searchQuery) {
      searchRequestIdRef.current += 1
      setIsLoading(false)
      return
    }

    const requestId = searchRequestIdRef.current + 1
    searchRequestIdRef.current = requestId
    setIsLoading(true)

    const timeoutId = setTimeout(() => {
      performSearch(searchQuery, requestId)
    }, 100)

    return () => clearTimeout(timeoutId)
  }, [query, performSearch])

  // Handle item selection
  const handleSelect = useCallback(
    (path: string) => {
      navigate(path)
      onOpenChange(false)
      setQuery('')
    },
    [navigate, onOpenChange]
  )

  // Clear state when dialog closes
  useEffect(() => {
    if (!open) {
      searchRequestIdRef.current += 1
      setQuery('')
      setIsLoading(false)
    }
  }, [open])

  useEffect(() => {
    if (open && query === '') {
      const favoriteResults = favorites || []
      const previousResults = lastSearchResults || []
      setResults(favoriteResults.length > 0 ? favoriteResults : previousResults)
    }
  }, [open, query, favorites, lastSearchResults])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>{t('globalSearch.title')}</DialogTitle>
        <DialogDescription>{t('globalSearch.description')}</DialogDescription>
      </DialogHeader>
      <DialogContent className="max-w-4xl gap-0 overflow-hidden p-0 sm:p-0">
        <Command shouldFilter={false} className="rounded-none">
          <CommandInput
            placeholder={t('globalSearch.placeholder')}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {isLoading ? (
                <div className="space-y-2 p-2">
                  {[0, 1, 2, 3].map((index) => (
                    <div key={index} className="flex items-center gap-3 py-2">
                      <Skeleton className="h-4 w-4 rounded-sm" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton
                          className={
                            index % 2 === 0 ? 'h-4 w-2/5' : 'h-4 w-1/3'
                          }
                        />
                        <Skeleton className="h-3 w-1/4" />
                      </div>
                      <Skeleton className="h-5 w-16" />
                    </div>
                  ))}
                </div>
              ) : !query.trim() ? (
                t('globalSearch.emptyHint')
              ) : (
                t('globalSearch.noResults')
              )}
            </CommandEmpty>

            {sidebarResults.length > 0 && (
              <CommandGroup heading={t('globalSearch.navigation')}>
                {sidebarResults.map((item) => {
                  const Icon = item.Icon
                  return (
                    <CommandItem
                      key={`nav-${item.id}`}
                      value={`${item.title} ${item.groupLabel || ''} ${item.url}`}
                      onSelect={() => handleSelect(item.url)}
                      className="flex items-center gap-3 py-3"
                    >
                      <Icon className="h-4 w-4 text-sidebar-primary" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.title}</span>
                          {item.groupLabel ? (
                            <Badge className="text-xs" variant="outline">
                              {item.groupLabel}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {item.url}
                        </div>
                      </div>
                      {item.isPinned ? (
                        <Badge className="text-xs" variant="secondary">
                          {t('sidebar.pinned', 'Pinned')}
                        </Badge>
                      ) : null}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}

            {actionResults.length > 0 && (
              <CommandGroup heading={t('globalSearch.actions')}>
                {actionResults.map((actionOption) => (
                  <CommandItem
                    key={actionOption.id}
                    value={`${actionOption.label} theme toggle mode`}
                    onSelect={() => {
                      actionOption.onSelect()
                      onOpenChange(false)
                      setQuery('')
                    }}
                    className="flex items-center gap-3 py-3"
                  >
                    <actionOption.icon className="h-4 w-4 text-sidebar-primary" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {actionOption.label}
                        </span>
                        {actionOption.id === 'toggle-theme' && (
                          <Badge className="text-xs" variant="outline">
                            {actualTheme === 'dark'
                              ? 'Switch to Light'
                              : 'Switch to Dark'}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {results && results.length > 0 && (
              <CommandGroup
                heading={
                  !query.trim() && (favorites || []).length > 0
                    ? t('globalSearch.favorites')
                    : t('globalSearch.resources')
                }
              >
                {results.map((result) => {
                  const metadata = getResourceCatalogEntry(result.resourceType)
                  const titleKey =
                    metadata && 'titleKey' in metadata
                      ? metadata.titleKey
                      : undefined
                  const resourceLabel = titleKey
                    ? t(titleKey, {
                        defaultValue:
                          metadata?.pluralLabel || result.resourceType,
                      })
                    : metadata?.pluralLabel || result.resourceType
                  const Icon = getResourceIconComponent(metadata?.icon)
                  const isFav = isFavorite(result.id)
                  const path = result.namespace
                    ? `/${result.resourceType}/${result.namespace}/${result.name}`
                    : `/${result.resourceType}/${result.name}`
                  return (
                    <CommandItem
                      key={result.id}
                      value={`${result.name} ${result.namespace || ''} ${result.resourceType} ${
                        resourceLabel
                      }`}
                      onSelect={() => handleSelect(path)}
                      className="flex items-center gap-3 py-3"
                    >
                      <Icon className="h-4 w-4 text-sidebar-primary" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{result.name}</span>
                          <Badge className="text-xs">{resourceLabel}</Badge>
                        </div>
                        {result.namespace && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Namespace: {result.namespace}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          toggleFavorite(result, e)
                        }}
                        className="p-1 hover:bg-accent rounded transition-colors z-10 relative"
                      >
                        {isFav ? (
                          <IconStarFilled className="h-3 w-3 text-yellow-500" />
                        ) : (
                          <IconStar className="h-3 w-3 text-muted-foreground opacity-50" />
                        )}
                      </button>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
