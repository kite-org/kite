import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { IconX } from '@tabler/icons-react'
import { AlertTriangle, ChevronsUpDown, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Role } from '@/types/api'
import { useUserList } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  role?: Role | null
  onAssign: (
    roleId: number,
    subjectType: 'user' | 'group',
    subject: string
  ) => void
  onUnassign: (
    roleId: number,
    subjectType: 'user' | 'group',
    subject: string
  ) => void
  isAssigning?: boolean
  isUnassigning?: boolean
}

export function RBACAssignmentDialog({
  open,
  onOpenChange,
  role,
  onAssign,
  onUnassign,
  isAssigning,
  isUnassigning,
}: Props) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [subjectType, setSubjectType] = useState<'user' | 'group'>('user')
  const [subject, setSubject] = useState('')
  const [userSelectOpen, setUserSelectOpen] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [pendingRemoval, setPendingRemoval] = useState<{
    subjectType: 'user' | 'group'
    subject: string
  } | null>(null)

  const { data: userList, isFetching: isFetchingUsers } = useUserList(
    1,
    50,
    subjectType === 'user' ? userSearch : ''
  )

  useEffect(() => {
    if (open) {
      setSubjectType('user')
      setSubject('')
      setUserSelectOpen(false)
      setUserSearch('')
      setPendingRemoval(null)
    }
  }, [open])

  const handleAssign = (e: React.FormEvent) => {
    e.preventDefault()
    if (!role || !subject.trim()) return
    onAssign(role.id, subjectType, subject.trim())
    setSubject('')
    setUserSearch('')
  }

  const handleRemoveAssignment = (
    assignmentSubjectType: 'user' | 'group',
    assignmentSubject: string
  ) => {
    if (!role) return

    // Check if removing current user's assignment
    if (
      assignmentSubjectType === 'user' &&
      assignmentSubject === user?.username
    ) {
      setPendingRemoval({
        subjectType: assignmentSubjectType,
        subject: assignmentSubject,
      })
      return
    }

    onUnassign(role.id, assignmentSubjectType, assignmentSubject)
  }

  const confirmPendingRemoval = () => {
    if (!role || !pendingRemoval) return
    onUnassign(role.id, pendingRemoval.subjectType, pendingRemoval.subject)
    setPendingRemoval(null)
  }

  const currentUsers =
    role?.assignments?.filter((a) => a.subjectType === 'user') || []
  const currentGroups =
    role?.assignments?.filter((a) => a.subjectType === 'group') || []
  const assignedUsers = new Set(currentUsers.map((a) => a.subject))
  const userSuggestions =
    subjectType === 'user'
      ? (userList?.users || [])
          .filter((u) => !assignedUsers.has(u.username))
          .sort((a, b) => a.username.localeCompare(b.username))
      : []

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {t('common.actions.assign', 'Assign')}{' '}
              {t('common.fields.role', 'Role')} - {role?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {(currentUsers.length > 0 || currentGroups.length > 0) && (
              <div className="space-y-3">
                <Label>
                  {t('common.fields.assignments', 'Current Assignments')}
                </Label>
                <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-3">
                  {currentUsers.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground mb-1">
                        {t('common.fields.users', 'Users')}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {currentUsers.map((a) => (
                          <Badge
                            key={a.id}
                            variant="secondary"
                            className="max-w-full gap-1 pl-2 pr-1"
                            title={a.subject}
                          >
                            <span className="min-w-0 truncate">
                              {a.subject}
                            </span>
                            <button
                              onClick={() =>
                                handleRemoveAssignment('user', a.subject)
                              }
                              className="ml-1 rounded-sm p-0.5 hover:bg-destructive/20 disabled:pointer-events-none disabled:opacity-50"
                              type="button"
                              disabled={isUnassigning}
                              aria-label={`${t('common.actions.remove', 'Remove')} ${a.subject}`}
                            >
                              <IconX className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {currentGroups.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground mb-1">
                        {t('common.fields.oidcGroups', 'OIDC Groups')}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {currentGroups.map((a) => (
                          <Badge
                            key={a.id}
                            variant="secondary"
                            className="max-w-full gap-1 pl-2 pr-1"
                            title={a.subject}
                          >
                            <span className="min-w-0 truncate">
                              {a.subject}
                            </span>
                            <button
                              onClick={() =>
                                handleRemoveAssignment('group', a.subject)
                              }
                              className="ml-1 rounded-sm p-0.5 hover:bg-destructive/20 disabled:pointer-events-none disabled:opacity-50"
                              type="button"
                              disabled={isUnassigning}
                              aria-label={`${t('common.actions.remove', 'Remove')} ${a.subject}`}
                            >
                              <IconX className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <form onSubmit={handleAssign} className="space-y-4">
              <div className="space-y-2">
                <Label>{t('common.fields.subjectType', 'Subject Type')}</Label>
                <Select
                  value={subjectType}
                  onValueChange={(v) => {
                    setSubjectType(v as 'user' | 'group')
                    setSubject('')
                    setUserSelectOpen(false)
                    setUserSearch('')
                  }}
                  disabled={isAssigning}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">
                      {t('common.fields.user', 'User')}
                    </SelectItem>
                    <SelectItem value="group">
                      {t('common.fields.oidcGroup', 'OIDC Group')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t('common.fields.subject', 'Subject')}</Label>
                {subjectType === 'user' ? (
                  <Popover
                    open={userSelectOpen}
                    onOpenChange={setUserSelectOpen}
                    modal
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={userSelectOpen}
                        disabled={isAssigning}
                        className="w-full justify-between"
                      >
                        <span
                          className={cn(
                            'truncate',
                            !subject && 'text-muted-foreground'
                          )}
                        >
                          {subject ||
                            t('common.placeholders.selectUser', 'Select user')}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-[var(--radix-popover-trigger-width)] p-0"
                      align="start"
                    >
                      <Command shouldFilter={false}>
                        <CommandInput
                          value={userSearch}
                          onValueChange={setUserSearch}
                          placeholder={t(
                            'common.placeholders.searchUsers',
                            'Search users...'
                          )}
                          className="h-9"
                        />
                        <CommandList
                          className="max-h-[min(45dvh,240px)] overflow-x-hidden overflow-y-auto overscroll-contain"
                          onWheelCapture={(event) => event.stopPropagation()}
                          onTouchMove={(event) => event.stopPropagation()}
                        >
                          {isFetchingUsers ? (
                            <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              {t('common.actions.search', 'Search')}...
                            </div>
                          ) : (
                            <>
                              <CommandEmpty>
                                {t(
                                  'common.messages.noUsersFound',
                                  'No users found'
                                )}
                              </CommandEmpty>
                              <CommandGroup className="p-0">
                                {!assignedUsers.has('*') && (
                                  <CommandItem
                                    value="*"
                                    className="min-h-11 rounded-none border-b px-3 py-1.5"
                                    onSelect={() => {
                                      setSubject('*')
                                      setUserSearch('')
                                      setUserSelectOpen(false)
                                    }}
                                  >
                                    <Avatar className="size-7">
                                      <AvatarFallback className="bg-muted-foreground text-xs font-medium text-background">
                                        *
                                      </AvatarFallback>
                                    </Avatar>
                                    <div className="flex min-w-0 flex-1 flex-col">
                                      <span className="truncate text-sm font-semibold">
                                        *
                                      </span>
                                      <span className="truncate text-xs font-medium text-muted-foreground">
                                        {t('rbac.anyUser', 'Any user')}
                                      </span>
                                    </div>
                                  </CommandItem>
                                )}
                                {userSuggestions.map((u) => (
                                  <CommandItem
                                    key={u.id}
                                    value={u.username}
                                    className="min-h-11 rounded-none border-b px-3 py-1.5 last:border-b-0"
                                    onSelect={() => {
                                      setSubject(u.username)
                                      setUserSearch('')
                                      setUserSelectOpen(false)
                                    }}
                                  >
                                    <Avatar className="size-7">
                                      <AvatarImage
                                        src={u.avatar_url}
                                        alt={u.name || u.username}
                                      />
                                      <AvatarFallback className="bg-muted-foreground text-xs font-medium text-background">
                                        {u.username.slice(0, 2).toUpperCase()}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div className="flex min-w-0 flex-1 flex-col">
                                      <span
                                        className="truncate text-sm font-semibold"
                                        title={u.username}
                                      >
                                        {u.username}
                                      </span>
                                      {u.name && (
                                        <span
                                          className="truncate text-xs font-medium text-muted-foreground"
                                          title={u.name}
                                        >
                                          {u.name}
                                        </span>
                                      )}
                                    </div>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={t(
                      'common.placeholders.subject',
                      'username or group name'
                    )}
                    disabled={isAssigning}
                  />
                )}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isAssigning || isUnassigning}
                >
                  {t('common.actions.cancel', 'Cancel')}
                </Button>
                <Button type="submit" disabled={!subject.trim() || isAssigning}>
                  {isAssigning
                    ? t('common.actions.assigning', 'Assigning...')
                    : t('common.actions.assign', 'Assign')}
                </Button>
              </DialogFooter>
            </form>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!pendingRemoval}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingRemoval(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div className="flex-1">
                <DialogTitle className="text-left">
                  {t('rbac.confirmRemoveOwnRoleTitle', 'Remove your role?')}
                </DialogTitle>
                <DialogDescription className="text-left">
                  {t(
                    'common.messages.confirmRemoveOwnRole',
                    'You are removing your own role assignment. This may affect your permissions. Are you sure?'
                  )}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingRemoval(null)}
              disabled={isUnassigning}
            >
              {t('common.actions.cancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmPendingRemoval}
              disabled={isUnassigning}
            >
              {isUnassigning
                ? t('common.actions.removing', 'Removing...')
                : t('common.actions.remove', 'Remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default RBACAssignmentDialog
