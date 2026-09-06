import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  deleteAdminKubeconfigToken,
  KubeconfigTokenStatus,
  useAdminKubeconfigTokens,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { KubeconfigTokenList } from '@/components/kubeconfig-token-list'

export function KubeconfigTokenManagement() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [owner, setOwner] = useState('')
  const [status, setStatus] = useState<KubeconfigTokenStatus | undefined>()
  const { data, isLoading, error } = useAdminKubeconfigTokens({
    page,
    size: pageSize,
    owner: owner || undefined,
    status,
  })
  const deleteMutation = useMutation({
    mutationFn: deleteAdminKubeconfigToken,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-kubeconfig-tokens'] })
      toast.success(
        t('kubeconfigTokens.deleteSuccess', 'Kubeconfig token deleted')
      )
    },
    onError: (error) => toast.error(error.message),
  })
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              {t('kubeconfigTokens.adminTitle', 'Kubeconfig Tokens')}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {t(
                'kubeconfigTokens.adminDescription',
                'Review and delete kubeconfig tokens for all users.'
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Input
              className="w-64"
              value={owner}
              onChange={(event) => {
                setOwner(event.target.value)
                setPage(1)
              }}
              placeholder={t(
                'kubeconfigTokens.ownerPlaceholder',
                'Filter by username'
              )}
            />
            <Select
              value={status ?? 'all'}
              onValueChange={(value) => {
                setStatus(
                  value === 'all' ? undefined : (value as KubeconfigTokenStatus)
                )
                setPage(1)
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t('kubeconfigTokens.allStatuses', 'All statuses')}
                </SelectItem>
                <SelectItem value="active">
                  {t('kubeconfigTokens.active', 'Active')}
                </SelectItem>
                <SelectItem value="expired">
                  {t('kubeconfigTokens.expired', 'Expired')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-destructive">{error.message}</p>
        ) : isLoading ? (
          <p className="text-muted-foreground">
            {t('common.messages.loading', 'Loading...')}
          </p>
        ) : (
          <>
            <KubeconfigTokenList
              tokens={data?.tokens ?? []}
              includeOwner
              onDelete={(token) => deleteMutation.mutate(token.id)}
              deletingId={deleteMutation.variables}
            />
            <div className="flex flex-col gap-3 px-2 py-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="hidden flex-1 text-sm text-muted-foreground lg:block">
                {t(
                  'kubeconfigTokens.totalTokens',
                  '{{count}} token(s) total.',
                  { count: data?.total ?? 0 }
                )}
              </p>
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 lg:w-fit">
                <div className="flex items-center justify-between gap-2 sm:justify-start">
                  <span className="text-sm text-muted-foreground">
                    {t('kubeconfigTokens.rowsPerPage', 'Rows per page:')}
                  </span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(value) => {
                      setPageSize(Number(value))
                      setPage(1)
                    }}
                  >
                    <SelectTrigger size="sm" className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[10, 20, 50, 100].map((size) => (
                        <SelectItem key={size} value={String(size)}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="flex items-center justify-center text-sm font-medium">
                  {t(
                    'kubeconfigTokens.pagination',
                    'Page {{page}} of {{totalPages}}',
                    { page, totalPages }
                  )}
                </p>
                <div className="flex items-center justify-end gap-2 sm:justify-start">
                  <Button
                    variant="outline"
                    className="size-8"
                    size="icon"
                    disabled={page === 1}
                    onClick={() => setPage((current) => current - 1)}
                    aria-label={t(
                      'kubeconfigTokens.previousPage',
                      'Go to previous page'
                    )}
                  >
                    <span aria-hidden>←</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="size-8"
                    size="icon"
                    disabled={page >= totalPages}
                    onClick={() => setPage((current) => current + 1)}
                    aria-label={t(
                      'kubeconfigTokens.nextPage',
                      'Go to next page'
                    )}
                  >
                    <span aria-hidden>→</span>
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
