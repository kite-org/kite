import { useCallback, useMemo, useState } from 'react'
import {
  IconCopy,
  IconEye,
  IconEyeOff,
  IconKey,
  IconPlus,
  IconShieldCheck,
  IconTrash,
} from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { APIKey } from '@/types/api'
import { createAPIKey, deleteAPIKey, useAPIKeyList } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog'

import { Action, ActionTable } from '../action-table'
import { APIKeyDialog } from './apikey-dialog'
import UserRoleAssignment from './user-role-assignment'

export function APIKeyManagement() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data: apiKeys = [], isLoading, error } = useAPIKeyList()

  const [showDialog, setShowDialog] = useState(false)
  const [deletingKey, setDeletingKey] = useState<APIKey | null>(null)
  const [assigningKey, setAssigningKey] = useState<APIKey | null>(null)
  const [visibleKeys, setVisibleKeys] = useState<Set<number>>(new Set())

  const toggleKeyVisibility = useCallback((id: number) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const copyToClipboard = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text)
      toast.success(t('common.messages.copied', 'Copied to clipboard'))
    },
    [t]
  )

  const columns = useMemo<ColumnDef<APIKey>[]>(
    () => [
      {
        id: 'name',
        header: t('common.fields.name', 'Name'),
        cell: ({ row: { original: apiKey } }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{apiKey.username}</span>
          </div>
        ),
      },
      {
        id: 'key',
        header: t('common.fields.apiKey', 'API Key'),
        cell: ({ row: { original: apiKey } }) => {
          const isVisible = visibleKeys.has(apiKey.id)
          const displayKey = isVisible ? apiKey.apiKey : '•'.repeat(18)

          return (
            <div className="flex items-center gap-2">
              <code className="text-sm bg-muted px-2 py-1 rounded">
                {displayKey}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleKeyVisibility(apiKey.id)}
              >
                {isVisible ? (
                  <IconEyeOff className="h-4 w-4" />
                ) : (
                  <IconEye className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(apiKey.apiKey)}
              >
                <IconCopy className="h-4 w-4" />
              </Button>
            </div>
          )
        },
      },
      {
        id: 'lastUsedAt',
        header: t('common.fields.lastUsed', 'Last Used'),
        cell: ({ row: { original: apiKey } }) =>
          apiKey.lastLoginAt ? (
            <span className="text-sm text-muted-foreground">
              {new Date(apiKey.lastLoginAt).toLocaleString()}
            </span>
          ) : (
            <Badge variant="secondary">
              {t('common.messages.neverUsed', 'Never')}
            </Badge>
          ),
      },
      {
        id: 'createdAt',
        header: t('common.fields.createdAt', 'Created At'),
        cell: ({ row: { original: apiKey } }) => (
          <span className="text-sm text-muted-foreground">
            {new Date(apiKey.createdAt).toLocaleString()}
          </span>
        ),
      },
      {
        id: 'roles',
        header: t('common.fields.roles', 'Roles'),
        cell: ({ row: { original: apiKey } }) => (
          <div className="text-sm text-muted-foreground">
            {apiKey.roles?.map((r) => r.name).join(', ') || '-'}
          </div>
        ),
      },
    ],
    [t, visibleKeys, toggleKeyVisibility, copyToClipboard]
  )

  const actions = useMemo<Action<APIKey>[]>(
    () => [
      {
        label: (
          <>
            <IconShieldCheck className="h-4 w-4" />
            {t('common.actions.assign', 'Assign')}
          </>
        ),
        onClick: (apiKey) => setAssigningKey(apiKey),
      },
      {
        label: (
          <div className="inline-flex items-center gap-2 text-destructive">
            <IconTrash className="h-4 w-4" />
            {t('common.actions.delete', 'Delete')}
          </div>
        ),
        onClick: (apiKey) => setDeletingKey(apiKey),
      },
    ],
    [t]
  )

  const createMutation = useMutation({
    mutationFn: createAPIKey,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['apikey-list'] })
      setShowDialog(false)
      setVisibleKeys(new Set([data.apiKey.id]))
      toast.success(
        t('common.messages.created', {
          resource: t('common.fields.apiKey', 'API Key'),
          defaultValue: 'API Key created successfully',
        })
      )
    },
    onError: () => {
      toast.error(
        t('common.messages.failedToCreate', {
          resource: t('common.fields.apiKey', 'API Key'),
          defaultValue: 'Failed to create API Key. Please try again.',
        })
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteAPIKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apikey-list'] })
      setDeletingKey(null)
      toast.success(
        t('common.messages.deleted', {
          resource: t('common.fields.apiKey', 'API Key'),
          defaultValue: 'API Key deleted successfully',
        })
      )
    },
    onError: () => {
      toast.error(
        t('common.messages.failedToDelete', {
          resource: t('common.fields.apiKey', 'API Key'),
          defaultValue: 'Failed to delete API Key. Please try again.',
        })
      )
    },
  })

  const handleCreate = useCallback(
    (data: { name: string }) => {
      createMutation.mutate(data)
    },
    [createMutation]
  )

  const handleDelete = useCallback(() => {
    if (deletingKey) {
      deleteMutation.mutate(deletingKey.id)
    }
  }, [deletingKey, deleteMutation])

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <p className="text-destructive">
            {t('common.messages.failedToLoad', {
              resource: t('common.fields.apiKeys', 'API Keys'),
              defaultValue: 'Failed to load API Keys',
            })}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <IconKey className="h-5 w-5" />
                {t('common.fields.apiKeys', 'API Key')}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {t(
                  'common.messages.manageApiKeysDescription',
                  'Manage API keys for programmatic access'
                )}
              </p>
            </div>
            <Button onClick={() => setShowDialog(true)}>
              <IconPlus className="mr-2 h-4 w-4" />
              {t('apikeyManagement.actions.add', 'Add API Key')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {apiKeys.length === 0 && !isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              <IconKey className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">
                {t('common.messages.noItemsConfigured', {
                  resource: t('common.fields.apiKeys', 'API keys'),
                  defaultValue: 'No API keys configured',
                })}
              </p>
              <p className="text-sm">
                {t('common.messages.createFirstItem', {
                  resource: t('common.fields.apiKey', 'API key'),
                  defaultValue:
                    'Create an API key to get started with programmatic access.',
                })}
              </p>
            </div>
          ) : (
            <ActionTable columns={columns} data={apiKeys} actions={actions} />
          )}
        </CardContent>
      </Card>

      <APIKeyDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        onSubmit={handleCreate}
        isLoading={createMutation.isPending}
      />

      <UserRoleAssignment
        open={!!assigningKey}
        onOpenChange={(open: boolean) => !open && setAssigningKey(null)}
        subject={
          assigningKey
            ? { type: 'user', name: assigningKey.username }
            : undefined
        }
      />

      <DeleteConfirmationDialog
        open={!!deletingKey}
        onOpenChange={(open: boolean) => !open && setDeletingKey(null)}
        onConfirm={handleDelete}
        resourceName={deletingKey?.username || ''}
        resourceType="API Key"
        isDeleting={deleteMutation.isPending}
      />
    </>
  )
}
