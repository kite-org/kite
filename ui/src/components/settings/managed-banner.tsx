import { IconInfoCircle } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'

export function ManagedBanner() {
  const { t } = useTranslation()

  return (
    <Alert className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
      <IconInfoCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
      <AlertDescription className="text-blue-700 dark:text-blue-300">
        {t(
          'settings.managedBanner',
          'This section is managed by configuration file and is read-only.'
        )}
      </AlertDescription>
    </Alert>
  )
}
