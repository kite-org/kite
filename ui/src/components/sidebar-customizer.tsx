import { useMemo, useState } from 'react'
import { useSidebarConfig } from '@/contexts/sidebar-config-context'
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  FolderPlus,
  PanelLeftOpen,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { CRDSelector } from '@/components/selector/crd-selector'

export function SidebarCustomizer({
  onOpenChange,
}: {
  onOpenChange?: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [selectedCRD, setSelectedCRD] = useState<
    | {
        name: string
        kind: string
      }
    | undefined
  >()
  const {
    config,
    isLoading,
    hasUpdate,
    toggleItemVisibility,
    toggleItemPin,
    toggleGroupCollapse,
    resetConfig,
    getIconComponent,
    toggleGroupVisibility,
    createCustomGroup,
    addCRDToGroup,
    removeCustomGroup,
    removeCRDToGroup,
    moveGroup,
  } = useSidebarConfig()

  const handleCreateGroup = () => {
    if (newGroupName.trim()) {
      createCustomGroup(newGroupName.trim())
      setNewGroupName('')
    }
  }

  const handleAddCRDToGroup = (groupId: string) => {
    if (selectedCRD && groupId) {
      addCRDToGroup(groupId, selectedCRD.name, selectedCRD.kind)
      setSelectedCRD(undefined)
    }
  }

  const pinnedItems = useMemo(() => {
    if (!config) return []
    return config.groups
      .flatMap((group) => group.items)
      .filter((item) => config.pinnedItems.includes(item.id))
  }, [config])

  const sortedGroups = useMemo(() => {
    if (!config) return []
    return [...config.groups].sort((a, b) => a.order - b.order)
  }, [config])

  if (isLoading || !config) {
    return null
  }

  return (
    <Dialog
      open={open}
      onOpenChange={() => {
        setOpen(!open)
        if (onOpenChange) onOpenChange(!open)
      }}
    >
      <DialogTrigger asChild>
        <DropdownMenuItem
          className="cursor-pointer"
          onSelect={(e) => {
            e.preventDefault()
            setOpen(true)
          }}
        >
          <PanelLeftOpen className="h-4 w-4" />
          <span>{t('sidebar.customize', 'Customize Sidebar')}</span>
          {hasUpdate && (
            <span className="ml-auto h-2 w-2 rounded-full bg-red-500" />
          )}
        </DropdownMenuItem>
      </DialogTrigger>

      <DialogContent className="!max-w-4xl max-h-[calc(100dvh-1rem)] p-0">
        <DialogHeader className="p-4 pb-2 sm:p-6 sm:pb-2">
          <DialogTitle className="flex items-center gap-2">
            <PanelLeftOpen className="h-5 w-5" />
            {t('sidebar.customizeTitle', 'Customize Sidebar')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 max-h-[calc(100dvh-10rem)] sm:px-6">
          <div className="space-y-6 pb-6">
            {pinnedItems.length > 0 && (
              <>
                <div className="space-y-3">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Pin className="h-4 w-4" />
                    {t('sidebar.pinnedItems', 'Pinned Items')} (
                    {pinnedItems.length})
                  </Label>
                  <div className="space-y-2">
                    {pinnedItems.map((item) => {
                      const IconComponent = getIconComponent(item.icon)
                      const title = item.titleKey
                        ? t(item.titleKey, { defaultValue: item.titleKey })
                        : ''
                      return (
                        <div
                          key={item.id}
                          className="flex flex-col gap-3 rounded-md border bg-muted/20 p-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <IconComponent className="h-4 w-4 text-sidebar-primary" />
                            <span className="text-sm">{title}</span>
                            <Badge variant="outline" className="text-xs">
                              {t('sidebar.pinned', 'Pinned')}
                            </Badge>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleItemPin(item.id)}
                            className="h-8 w-8 p-0"
                            aria-label="Unpin item"
                          >
                            <PinOff className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                </div>
                <Separator />
              </>
            )}

            <div className="space-y-4">
              <Label className="text-sm font-medium">
                {t('sidebar.menuGroups', 'Menu Groups')}
              </Label>

              {sortedGroups.map((group, index) => (
                <div key={group.id} className="space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-medium">
                        {group.nameKey
                          ? t(group.nameKey, { defaultValue: group.nameKey })
                          : ''}
                      </h4>
                      {group.isCustom && (
                        <Badge variant="outline" className="text-xs">
                          Custom
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {
                          group.items.filter(
                            (item) => !config.hiddenItems.includes(item.id)
                          ).length
                        }
                        /{group.items.length}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleGroupCollapse(group.id)}
                        className="h-8 px-2 text-xs"
                      >
                        {group.collapsed
                          ? t('sidebar.expand', 'Expand')
                          : t('sidebar.collapse', 'Collapse')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleGroupVisibility(group.id)}
                        className="h-8 w-8 p-0"
                        title={group.visible ? 'Hide' : 'Show'}
                        aria-label={group.visible ? 'Hide group' : 'Show group'}
                      >
                        {!group.visible ? (
                          <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => moveGroup(group.id, 'up')}
                        className="h-8 w-8 p-0"
                        title={t('sidebar.moveUp', 'Move up')}
                        disabled={index === 0}
                        aria-label={t('sidebar.moveUp', 'Move up')}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => moveGroup(group.id, 'down')}
                        className="h-8 w-8 p-0"
                        title={t('sidebar.moveDown', 'Move down')}
                        disabled={index === sortedGroups.length - 1}
                        aria-label={t('sidebar.moveDown', 'Move down')}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      {group.isCustom && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeCustomGroup(group.id)}
                          className="h-8 w-8 p-0"
                          title="Delete custom group"
                          aria-label="Delete custom group"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  <div
                    className={`grid gap-2 pl-4 ${group.collapsed ? 'hidden' : ''} ${!group.visible ? 'opacity-50 pointer-events-none' : ''}`}
                  >
                    {group.items.map((item) => {
                      const IconComponent = getIconComponent(item.icon)
                      const isHidden = config.hiddenItems.includes(item.id)
                      const isPinned = config.pinnedItems.includes(item.id)
                      const title = item.titleKey
                        ? t(item.titleKey, { defaultValue: item.titleKey })
                        : ''

                      return (
                        <div
                          key={item.id}
                          className={`flex flex-col gap-3 rounded border p-2 transition-colors sm:flex-row sm:items-center sm:justify-between ${
                            isHidden
                              ? 'opacity-50 bg-muted/10'
                              : 'bg-background'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <IconComponent className="h-4 w-4 text-sidebar-primary" />
                            <span className="text-sm">{title}</span>
                            {isPinned && (
                              <Badge variant="secondary" className="text-xs">
                                <Pin className="h-3 w-3 mr-1" />
                                {t('sidebar.pinned', 'Pinned')}
                              </Badge>
                            )}
                          </div>

                          <div className="flex items-center gap-1 self-end sm:self-auto">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleItemPin(item.id)}
                              className={`h-8 w-8 p-0 ${isPinned ? 'text-primary' : 'text-muted-foreground'}`}
                              title={isPinned ? 'Unpin' : 'Pin to top'}
                              aria-label={isPinned ? 'Unpin item' : 'Pin item'}
                            >
                              {isPinned ? (
                                <PinOff className="h-3.5 w-3.5" />
                              ) : (
                                <Pin className="h-3.5 w-3.5" />
                              )}
                            </Button>
                            {group.isCustom ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  removeCRDToGroup(group.id, item.id)
                                }
                                className="h-8 w-8 p-0"
                                title="Remove from group"
                                aria-label="Remove from group"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleItemVisibility(item.id)}
                                className="h-8 w-8 p-0"
                                title={isHidden ? 'Show' : 'Hide'}
                                aria-label={
                                  isHidden ? 'Show item' : 'Hide item'
                                }
                              >
                                {isHidden ? (
                                  <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {group.isCustom && (
                      <div className="flex flex-col gap-2 rounded border bg-muted/5 p-2 sm:flex-row">
                        <CRDSelector
                          selectedCRD={selectedCRD?.name || ''}
                          onCRDChange={(crdName, kind) =>
                            setSelectedCRD({
                              name: crdName,
                              kind: kind,
                            })
                          }
                          placeholder="Select CRD to add..."
                        />
                        <Button
                          onClick={() => handleAddCRDToGroup(group.id)}
                          disabled={!selectedCRD}
                          size="sm"
                          className="gap-2"
                          title="Add CRD to group"
                        >
                          <Plus className="h-4 w-4" />
                          Add
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <Separator />

            <div className="space-y-4">
              {/* Create new CRD group */}
              <div className="space-y-3 p-4 border rounded-md bg-muted/10">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <FolderPlus className="h-4 w-4" />
                  {t('sidebar.createGroup', 'Create New CRD Group')}
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    placeholder="Group name (e.g., CRDs)"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleCreateGroup()
                      }
                    }}
                  />
                  <Button
                    onClick={handleCreateGroup}
                    disabled={!newGroupName.trim()}
                    aria-label="Create CRD group"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t bg-muted/10 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6 sm:pt-4">
          <Button variant="outline" onClick={resetConfig} className="gap-2">
            <RotateCcw className="h-4 w-4" />
            {t('sidebar.resetToDefault', 'Reset to Default')}
          </Button>
          <Button
            onClick={() => {
              setOpen(!open)
              if (onOpenChange) onOpenChange(!open)
            }}
          >
            {t('common.done', 'Done')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
