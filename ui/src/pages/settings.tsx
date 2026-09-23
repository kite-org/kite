import { useMemo } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { usePageTitle } from '@/hooks/use-page-title'
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import { createSettingsTabs } from '@/components/settings/settings-sections'

export function SettingsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const tabs = useMemo(() => createSettingsTabs(t), [t])

  usePageTitle('Settings')

  if (!user?.isAdmin()) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <ShieldAlert className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium">{t('errors.noPermission.title')}</p>
        <p className="text-sm text-muted-foreground">
          {t('errors.noPermission.adminRequired')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl">{t('settings.title', 'Settings')}</h1>
        </div>
        <p className="text-muted-foreground">
          {t('settings.description', 'Manage clusters, roles and permissions')}
        </p>
      </div>

      <ResponsiveTabs tabs={tabs} />
    </div>
  )
}
