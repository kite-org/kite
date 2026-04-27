import { Component, ErrorInfo, ReactNode } from 'react'
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  /** Rendered instead of the default fallback when provided */
  fallback?: ReactNode
  /** Called when an error is caught */
  onError?: (error: Error, info: ErrorInfo) => void
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info)
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback
      return <ErrorFallback error={this.state.error} onReset={this.reset} />
    }
    return this.props.children
  }
}

function ErrorFallback({
  error,
  onReset,
}: {
  error: Error
  onReset: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
      <IconAlertTriangle className="h-10 w-10 text-destructive" />
      <div className="space-y-1">
        <p className="font-semibold text-sm">
          {t('common.messages.somethingWentWrong', 'Something went wrong')}
        </p>
        <p className="text-muted-foreground text-xs max-w-sm break-all">
          {error.message}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onReset}>
        <IconRefresh className="mr-1 h-3.5 w-3.5" />
        {t('common.actions.retry', 'Try again')}
      </Button>
    </div>
  )
}
