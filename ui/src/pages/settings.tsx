import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { usePageTitle } from '@/hooks/use-page-title'
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import {
  createSettingsTabs,
  desktopSettingsSectionRegistry,
  type SettingsSectionDefinition,
} from '@/components/settings/settings-sections'

export function SettingsPage({
  sections,
  description = 'settings.description',
}: {
  sections?: SettingsSectionDefinition[]
  description?: string
}) {
  const { t } = useTranslation()
  const tabs = useMemo(() => {
    return createSettingsTabs(t, sections)
  }, [t, sections])

  usePageTitle('Settings')

  return (
    <div className="space-y-2">
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl">{t('settings.title', 'Settings')}</h1>
        </div>
        <p className="text-muted-foreground">
          {t(description, 'Manage clusters, roles and permissions')}
        </p>
      </div>

      <ResponsiveTabs tabs={tabs} />
    </div>
  )
}

export function DesktopSettingsPage() {
  return (
    <SettingsPage
      sections={desktopSettingsSectionRegistry}
      description="desktop.settingsDescription"
    />
  )
}
