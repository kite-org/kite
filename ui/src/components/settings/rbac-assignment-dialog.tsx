import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { IconX } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { Role } from '@/types/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
}

export function RBACAssignmentDialog({
  open,
  onOpenChange,
  role,
  onAssign,
  onUnassign,
}: Props) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [subjectType, setSubjectType] = useState<'user' | 'group'>('user')
  const [subject, setSubject] = useState('')

  useEffect(() => {
    if (open) {
      setSubjectType('user')
      setSubject('')
    }
  }, [open])

  const handleAssign = (e: React.FormEvent) => {
    e.preventDefault()
    if (!role || !subject.trim()) return
    onAssign(role.id, subjectType, subject.trim())
    setSubject('')
  }

  const handleRemoveAssignment = (
    assignmentSubjectType: 'user' | 'group',
    assignmentSubject: string
  ) => {
    if (!role) return

    // Check if removing current user's assignment
    if (
      assignmentSubjectType === 'user' &&
      user &&
      assignmentSubject === user.username
    ) {
      const confirmed = window.confirm(
        t(
          'common.messages.confirmRemoveOwnRole',
          'You are removing your own role assignment. This may affect your permissions. Are you sure?'
        )
      )
      if (!confirmed) return
    }

    onUnassign(role.id, assignmentSubjectType, assignmentSubject)
  }

  const currentUsers =
    role?.assignments?.filter((a) => a.subjectType === 'user') || []
  const currentGroups =
    role?.assignments?.filter((a) => a.subjectType === 'group') || []

  return (
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
                          className="gap-1 pl-2 pr-1"
                        >
                          {a.subject}
                          <button
                            onClick={() =>
                              handleRemoveAssignment('user', a.subject)
                            }
                            className="ml-1 hover:bg-destructive/20 rounded-sm p-0.5"
                            type="button"
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
                          className="gap-1 pl-2 pr-1"
                        >
                          {a.subject}
                          <button
                            onClick={() =>
                              handleRemoveAssignment('group', a.subject)
                            }
                            className="ml-1 hover:bg-destructive/20 rounded-sm p-0.5"
                            type="button"
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
                onValueChange={(v) => setSubjectType(v as 'user' | 'group')}
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
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={t(
                  'common.placeholders.subject',
                  'username or group name'
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {t('common.actions.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={!subject.trim()}>
                {t('common.actions.assign', 'Assign')}
              </Button>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default RBACAssignmentDialog
