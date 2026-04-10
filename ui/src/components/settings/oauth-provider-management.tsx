import { useCallback, useMemo, useState } from 'react'
import { IconEdit, IconKey, IconPlus, IconTrash } from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { OAuthProvider } from '@/types/api'
import {
  createOAuthProvider,
  deleteOAuthProvider,
  OAuthProviderCreateRequest,
  OAuthProviderUpdateRequest,
  updateOAuthProvider,
  useOAuthProviderList,
} from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog'

import { Action, ActionTable } from '../action-table'
import { OAuthProviderDialog } from './oauth-provider-dialog'

export function OAuthProviderManagement() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  // Use real API to fetch OAuth providers
  const { data: providers = [], isLoading, error } = useOAuthProviderList()

  const [showProviderDialog, setShowProviderDialog] = useState(false)
  const [editingProvider, setEditingProvider] = useState<OAuthProvider | null>(
    null
  )
  const [deletingProvider, setDeletingProvider] =
    useState<OAuthProvider | null>(null)
  const getStatusBadge = useCallback(
    (provider: OAuthProvider) => {
      if (!provider.enabled) {
        return (
          <Badge variant="secondary">{t('common.disabled', 'Disabled')}</Badge>
        )
      }
      return <Badge variant="default">{t('common.enabled', 'Enabled')}</Badge>
    },
    [t]
  )

  const columns = useMemo<ColumnDef<OAuthProvider>[]>(
    () => [
      {
        id: 'name',
        header: t('common.name', 'Name'),
        cell: ({ row: { original: provider } }) => (
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{provider.name}</span>
            </div>
            {provider.scopes && (
              <div className="text-sm text-muted-foreground">
                Scopes: {provider.scopes}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'clientId',
        header: t('oauthManagement.table.clientId', 'Client ID'),
        cell: ({ row: { original: provider } }) => (
          <code className="text-sm bg-muted px-2 py-1 rounded">
            {provider.clientId}
          </code>
        ),
      },
      {
        id: 'issuer',
        header: t('oauthManagement.table.issuer', 'Issuer'),
        cell: ({ row: { original: provider } }) => (
          <div className="text-sm text-muted-foreground">
            {provider.issuer || '-'}
          </div>
        ),
      },
      {
        id: 'status',
        header: t('common.status', 'Status'),
        cell: ({ row: { original: provider } }) => (
          <div className="flex items-center gap-3">
            {getStatusBadge(provider)}
          </div>
        ),
      },
    ],
    [getStatusBadge, t]
  )

  const actions = useMemo<Action<OAuthProvider>[]>(
    () => [
      {
        label: (
          <>
            <IconEdit className="h-4 w-4" />
            {t('common.edit', 'Edit')}
          </>
        ),
        onClick: (provider) => {
          setEditingProvider(provider)
          setShowProviderDialog(true)
        },
      },
      {
        label: (
          <div className="inline-flex items-center gap-2 text-destructive">
            <IconTrash className="h-4 w-4" />
            {t('common.delete', 'Delete')}
          </div>
        ),
        onClick: (provider) => {
          setDeletingProvider(provider)
        },
      },
    ],
    [t]
  )

  // Create provider mutation
  const createMutation = useMutation({
    mutationFn: createOAuthProvider,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oauth-provider-list'] })
      toast.success(
        t(
          'oauthManagement.messages.created',
          'OAuth provider created successfully'
        )
      )
      setShowProviderDialog(false)
    },
    onError: (error: Error) => {
      toast.error(
        error.message ||
          t(
            'oauthManagement.messages.createError',
            'Failed to create OAuth provider'
          )
      )
    },
  })

  // Update provider mutation
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number
      data: OAuthProviderUpdateRequest
    }) => updateOAuthProvider(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oauth-provider-list'] })
      toast.success(
        t(
          'oauthManagement.messages.updated',
          'OAuth provider updated successfully'
        )
      )
      setShowProviderDialog(false)
      setEditingProvider(null)
    },
    onError: (error: Error) => {
      toast.error(
        error.message ||
          t(
            'oauthManagement.messages.updateError',
            'Failed to update OAuth provider'
          )
      )
    },
  })

  // Delete provider mutation
  const deleteMutation = useMutation({
    mutationFn: deleteOAuthProvider,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oauth-provider-list'] })
      toast.success(
        t(
          'oauthManagement.messages.deleted',
          'OAuth provider deleted successfully'
        )
      )
      setDeletingProvider(null)
    },
    onError: (error: Error) => {
      toast.error(
        error.message ||
          t(
            'oauthManagement.messages.deleteError',
            'Failed to delete OAuth provider'
          )
      )
    },
  })

  const handleSubmitProvider = (providerData: OAuthProviderCreateRequest) => {
    if (editingProvider) {
      // Update existing provider
      const updateData: OAuthProviderUpdateRequest = {
        ...providerData,
        // If clientSecret is empty in edit mode, don't send it
        ...(providerData.clientSecret
          ? { clientSecret: providerData.clientSecret }
          : {}),
      }
      updateMutation.mutate({
        id: editingProvider.id,
        data: updateData,
      })
    } else {
      // Create new provider
      createMutation.mutate(providerData)
    }
  }

  const handleDeleteProvider = () => {
    if (!deletingProvider) return
    deleteMutation.mutate(deletingProvider.id)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">
          {t('common.loading', 'Loading...')}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-destructive">
          {t(
            'oauthManagement.errors.loadFailed',
            'Failed to load OAuth providers'
          )}
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
                <IconKey className="h-5 w-5" />
                {t('oauthManagement.title', 'OAuth Provider Management')}
              </CardTitle>
            </div>
            <Button
              onClick={() => {
                setEditingProvider(null)
                setShowProviderDialog(true)
              }}
              className="gap-2"
            >
              <IconPlus className="h-4 w-4" />
              {t('oauthManagement.actions.add', 'Add Provider')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ActionTable actions={actions} data={providers} columns={columns} />

          {providers.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <IconKey className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>
                {t(
                  'oauthManagement.empty.title',
                  'No OAuth providers configured'
                )}
              </p>
              <p className="text-sm mt-1">
                {t(
                  'oauthManagement.empty.description',
                  'Add your first OAuth provider'
                )}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Provider Dialog (Add/Edit) */}
      <OAuthProviderDialog
        open={showProviderDialog}
        onOpenChange={(open) => {
          setShowProviderDialog(open)
          if (!open) {
            setEditingProvider(null)
          }
        }}
        provider={editingProvider}
        onSubmit={handleSubmitProvider}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        open={!!deletingProvider}
        onOpenChange={() => setDeletingProvider(null)}
        onConfirm={handleDeleteProvider}
        resourceName={deletingProvider?.name || ''}
        resourceType="OAuth provider"
        additionalNote={t(
          'oauthManagement.deleteConfirmation',
          'This action will remove the OAuth provider configuration. Users will no longer be able to login using this provider.'
        )}
      />
    </div>
  )
}
