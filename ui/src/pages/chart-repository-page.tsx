import { useTranslation } from 'react-i18next'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function ChartRepositoryPage() {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('nav.chartRepositories')}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {t('helm.messages.chartRepositoryTodo')}
      </CardContent>
    </Card>
  )
}
