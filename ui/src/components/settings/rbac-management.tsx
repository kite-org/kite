import { useMemo, useState } from 'react'
import {
  IconEdit,
  IconPlus,
  IconShieldCheck,
  IconTrash,
} from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Role } from '@/types/api'
import {
  assignRole,
  createRole,
  deleteRole,
  unassignRole,
  updateRole,
  useRoleList,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog'

import { Action, ActionTable } from '../action-table'
import { Badge } from '../ui/badge'
import { RBACAssignmentDialog } from './rbac-assignment-dialog'
import { RBACDialog } from './rbac-dialog'

export function RBACManagement() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data: roles = [], isLoading, error } = useRoleList()

  const [showDialog, setShowDialog] = useState(false)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [deletingRole, setDeletingRole] = useState<Role | null>(null)
  const [showAssignDialog, setShowAssignDialog] = useState(false)
  const [assigningRole, setAssigningRole] = useState<Role | null>(null)

  const columns = useMemo<ColumnDef<Role>[]>(
    () => [
      {
        id: 'name',
        header: t('common.fields.name', 'Name'),
        cell: ({ row: { original: r } }) => (
          <div>
            <div className="flex items-center">
              <span className="font-medium">{r.name}</span>{' '}
              {r.isSystem && <Badge variant="secondary">System</Badge>}
            </div>
            {r.description && (
              <div className="text-sm text-muted-foreground">
                {r.description}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'clusters',
        header: 'Clusters',
        cell: ({ row: { original: r } }) => (
          <div className="text-sm text-muted-foreground">
            {r.clusters.length > 0 ? (
              r.clusters.join(', ')
            ) : (
              <span className="text-xs text-muted-foreground">-</span>
            )}
          </div>
        ),
      },
      {
        id: 'namespaces',
        header: 'Namespaces',
        cell: ({ row: { original: r } }) => (
          <div className="text-sm text-muted-foreground">
            {r.namespaces.length > 0 ? (
              r.namespaces.join(', ')
            ) : (
              <span className="text-xs text-muted-foreground">-</span>
            )}
          </div>
        ),
      },

      {
        id: 'Resources',
        header: 'Resources',
        cell: ({ row: { original: r } }) => (
          <div className="text-sm text-muted-foreground">
            {r.resources.length > 0 ? (
              r.resources.join(', ')
            ) : (
              <span className="text-xs text-muted-foreground">-</span>
            )}
          </div>
        ),
      },
      {
        id: 'verbs',
        header: 'Verbs',
        cell: ({ row: { original: r } }) => (
          <div className="text-sm text-muted-foreground">
            {r.verbs.length > 0 ? (
              r.verbs.join(', ')
            ) : (
              <span className="text-xs text-muted-foreground">-</span>
            )}
          </div>
        ),
      },
      {
        id: 'assignments',
        header: 'Assignments',
        cell: ({ row: { original: r } }) => {
          const users =
            r.assignments?.filter((a) => a.subjectType === 'user') || []
          const groups =
            r.assignments?.filter((a) => a.subjectType === 'group') || []
          const maxShow = 2
          return (
            <div className="flex flex-wrap gap-1 text-xs max-w-[200px]">
              {users.slice(0, maxShow).map((a) => (
                <Badge key={a.id} variant="secondary" className="text-xs">
                  user: {a.subject}
                </Badge>
              ))}
              {users.length > maxShow && (
                <Badge variant="outline" className="text-xs">
                  +{users.length - maxShow}
                </Badge>
              )}
              {groups.slice(0, maxShow).map((a) => (
                <Badge key={a.id} variant="secondary" className="text-xs">
                  group: {a.subject}
                </Badge>
              ))}
              {groups.length > maxShow && (
                <Badge variant="outline" className="text-xs">
                  +{groups.length - maxShow}
                </Badge>
              )}
              {users.length === 0 && groups.length === 0 && (
                <span className="text-xs text-muted-foreground">-</span>
              )}
            </div>
          )
        },
      },
    ],
    [t]
  )

  const actions = useMemo<Action<Role>[]>(
    () => [
      {
        label: (
          <>
            <IconShieldCheck className="h-4 w-4" />
            {t('common.actions.assign', 'Assign')}
          </>
        ),
        onClick: (r) => {
          setAssigningRole(r)
          setShowAssignDialog(true)
        },
      },
      {
        label: (
          <>
            <IconEdit className="h-4 w-4" />
            {t('common.actions.edit', 'Edit')}
          </>
        ),
        shouldDisable: (role) => !!role.isSystem,
        onClick: (role) => {
          setEditingRole(role)
          setShowDialog(true)
        },
      },
      {
        label: (
          <div className="inline-flex items-center gap-2 text-destructive">
            <IconTrash className="h-4 w-4" />
            {t('common.actions.delete', 'Delete')}
          </div>
        ),
        shouldDisable: (role) => !!role.isSystem,
        onClick: (role) => {
          setDeletingRole(role)
        },
      },
    ],
    [t]
  )

  const createMutation = useMutation({
    mutationFn: (data: Partial<Role>) => createRole(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role-list'] })
      toast.success(
        t('common.messages.created', {
          resource: t('common.fields.role', 'Role'),
          defaultValue: 'Role created',
        })
      )
      setShowDialog(false)
    },
    onError: (err: Error) =>
      toast.error(
        err.message ||
          t('common.messages.failedToCreate', {
            resource: t('common.fields.role', 'role'),
            defaultValue: 'Failed to create role',
          })
      ),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Role> }) =>
      updateRole(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role-list'] })
      toast.success(
        t('common.messages.updated', {
          resource: t('common.fields.role', 'Role'),
          defaultValue: 'Role updated',
        })
      )
      setShowDialog(false)
      setEditingRole(null)
    },
    onError: (err: Error) =>
      toast.error(
        err.message ||
          t('common.messages.failedToUpdate', {
            resource: t('common.fields.role', 'role'),
            defaultValue: 'Failed to update role',
          })
      ),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteRole(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role-list'] })
      toast.success(
        t('common.messages.deleted', {
          resource: t('common.fields.role', 'Role'),
          defaultValue: 'Role deleted',
        })
      )
      setDeletingRole(null)
    },
    onError: (err: Error) =>
      toast.error(
        err.message ||
          t('common.messages.failedToDelete', {
            resource: t('common.fields.role', 'role'),
            defaultValue: 'Failed to delete role',
          })
      ),
  })

  const handleSubmitRole = (data: Partial<Role>) => {
    if (editingRole) {
      updateMutation.mutate({ id: editingRole.id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  const handleDeleteRole = () => {
    if (!deletingRole) return
    deleteMutation.mutate(deletingRole.id)
  }

  const handleAssign = async (
    roleId: number,
    subjectType: 'user' | 'group',
    subject: string
  ) => {
    try {
      await assignRole(roleId, { subjectType, subject })
      await queryClient.invalidateQueries({ queryKey: ['role-list'] })

      // Update assigningRole with fresh data to show the new assignment immediately
      if (assigningRole?.id === roleId) {
        const updatedRoles = queryClient.getQueryData<Role[]>(['role-list'])
        const updatedRole = updatedRoles?.find((r) => r.id === roleId)
        if (updatedRole) {
          setAssigningRole(updatedRole)
        }
      }

      toast.success(t('common.messages.assigned', 'Assigned'))
    } catch (err: unknown) {
      toast.error(
        (err as Error).message ||
          t('common.messages.failedToAssign', 'Failed to assign')
      )
    }
  }

  const handleUnassign = async (
    roleId: number,
    subjectType: 'user' | 'group',
    subject: string
  ) => {
    try {
      await unassignRole(roleId, subjectType, subject)
      await queryClient.invalidateQueries({ queryKey: ['role-list'] })

      if (assigningRole?.id === roleId) {
        const updatedRoles = queryClient.getQueryData<Role[]>(['role-list'])
        const updatedRole = updatedRoles?.find((r) => r.id === roleId)
        if (updatedRole) {
          setAssigningRole(updatedRole)
        }
      }

      toast.success(t('common.messages.unassigned', 'Unassigned'))
    } catch (err: unknown) {
      toast.error(
        (err as Error).message ||
          t('common.messages.failedToUnassign', 'Failed to unassign')
      )
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">
          {t('common.messages.loading', 'Loading...')}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-destructive">
          {t('common.messages.failedToLoad', {
            resource: t('common.fields.roles', 'roles'),
            defaultValue: 'Failed to load roles',
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <IconShieldCheck className="h-5 w-5" />
                {t('common.fields.roles', 'Role Management')}
              </CardTitle>
            </div>
            <Button
              onClick={() => {
                setEditingRole(null)
                setShowDialog(true)
              }}
              className="gap-2"
            >
              <IconPlus className="h-4 w-4" />
              {t('common.actions.add', 'Add')} {t('common.fields.role', 'Role')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ActionTable actions={actions} data={roles} columns={columns} />
          {roles.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <IconShieldCheck className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>
                {t('common.messages.noItemsConfigured', {
                  resource: t('common.fields.roles', 'roles'),
                  defaultValue: 'No roles configured',
                })}
              </p>
              <p className="text-sm mt-1">
                {t('common.messages.createFirstItem', {
                  resource: t('common.fields.role', 'role'),
                  defaultValue: 'Create roles to grant permissions',
                })}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <RBACDialog
        open={showDialog}
        onOpenChange={(open) => {
          setShowDialog(open)
          if (!open) setEditingRole(null)
        }}
        role={editingRole}
        onSubmit={handleSubmitRole}
      />

      <RBACAssignmentDialog
        open={showAssignDialog}
        onOpenChange={(open) => {
          setShowAssignDialog(open)
          if (!open) setAssigningRole(null)
        }}
        role={assigningRole}
        onAssign={handleAssign}
        onUnassign={handleUnassign}
      />

      <DeleteConfirmationDialog
        open={!!deletingRole}
        onOpenChange={() => setDeletingRole(null)}
        onConfirm={handleDeleteRole}
        resourceName={deletingRole?.name || ''}
        resourceType="role"
      />
    </div>
  )
}

export default RBACManagement
