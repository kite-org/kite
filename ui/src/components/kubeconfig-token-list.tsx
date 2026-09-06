import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { KubeconfigToken } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface KubeconfigTokenListProps {
  tokens: KubeconfigToken[]
  includeOwner?: boolean
  onDelete: (token: KubeconfigToken) => void
  deletingId?: number
}

export function KubeconfigTokenList({
  tokens,
  includeOwner = false,
  onDelete,
  deletingId,
}: KubeconfigTokenListProps) {
  const { t } = useTranslation()
  const [tokenToDelete, setTokenToDelete] = useState<KubeconfigToken | null>(
    null
  )

  if (tokens.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t('kubeconfigTokens.empty', 'No kubeconfig tokens found.')}
      </p>
    )
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            {includeOwner && (
              <TableHead>{t('common.fields.owner', 'Owner')}</TableHead>
            )}
            <TableHead>{t('common.fields.createdAt', 'Created At')}</TableHead>
            <TableHead>
              {t('kubeconfigTokens.expiresAt', 'Expires At')}
            </TableHead>
            <TableHead>{t('common.fields.lastUsed', 'Last Used')}</TableHead>
            <TableHead>{t('common.fields.status', 'Status')}</TableHead>
            <TableHead>{t('common.fields.actions', 'Actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tokens.map((token) => {
            const expired = new Date(token.expiresAt) <= new Date()
            return (
              <TableRow key={token.id}>
                {includeOwner && <TableCell>{token.owner || '-'}</TableCell>}
                <TableCell>
                  {new Date(token.createdAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  {new Date(token.expiresAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  {token.lastUsedAt
                    ? new Date(token.lastUsedAt).toLocaleString()
                    : t('common.messages.neverUsed', 'Never')}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      expired
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                        : 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300'
                    }
                  >
                    {expired
                      ? t('kubeconfigTokens.expired', 'Expired')
                      : t('kubeconfigTokens.active', 'Active')}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={deletingId === token.id}
                    aria-label={t('kubeconfigTokens.delete', 'Delete')}
                    onClick={() => setTokenToDelete(token)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <Dialog
        open={tokenToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setTokenToDelete(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t(
                'kubeconfigTokens.deleteConfirmTitle',
                'Delete kubeconfig token?'
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                'kubeconfigTokens.deleteConfirmDescription',
                'This token will be deleted, become invalid immediately, and cannot be recovered.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTokenToDelete(null)}
              disabled={deletingId === tokenToDelete?.id}
            >
              {t('common.actions.cancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingId === tokenToDelete?.id}
              onClick={() => {
                if (tokenToDelete) onDelete(tokenToDelete)
                setTokenToDelete(null)
              }}
            >
              {t('kubeconfigTokens.delete', 'Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
