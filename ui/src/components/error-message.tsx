import { PackageX, RotateCcw, ShieldX, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  isCRDNotInstalledError,
  isRBACError,
  translateError,
} from '@/lib/utils'

import { Button } from './ui/button'

interface ErrorMessageProps {
  resourceName: string
  error: Error | unknown
  fallbackKey?: string
  className?: string
  refetch: () => void
}

export function ErrorMessage({
  resourceName,
  refetch,
  error,
  fallbackKey = 'common.messages.error',
}: ErrorMessageProps) {
  const { t } = useTranslation()

  if (!error) {
    return null
  }

  const isRBAC = error instanceof Error && isRBACError(error.message)
  const isCRDMissing =
    error instanceof Error && isCRDNotInstalledError(error.message)
  const message =
    error instanceof Error ? translateError(error, t) : t(fallbackKey)

  return (
    <div className="h-72 flex flex-col items-center justify-center">
      <div className="mb-4">
        {isRBAC ? (
          <ShieldX className="h-16 w-16 text-amber-500" />
        ) : isCRDMissing ? (
          <PackageX className="h-16 w-16 text-muted-foreground" />
        ) : (
          <XCircle className="h-16 w-16 text-red-500" />
        )}
      </div>
      <h3
        className={`text-lg font-medium mb-1 ${isRBAC ? 'text-amber-600' : isCRDMissing ? 'text-muted-foreground' : 'text-red-500'}`}
      >
        {isCRDMissing
          ? t('errors.crdNotInstalledTitle')
          : t('resourceTable.errorLoading', { resourceName })}
      </h3>
      <p className="text-muted-foreground mb-4">{message}</p>
      {!isCRDMissing && (
        <Button variant="outline" onClick={() => refetch()}>
          <RotateCcw className="h-4 w-4 mr-2" />
          {t('resourceTable.tryAgain')}
        </Button>
      )}
    </div>
  )
}
