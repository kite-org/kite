import { useTranslation } from 'react-i18next'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { usePluginReadme, type CatalogPlugin } from '@/lib/api/plugins'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

export function PluginReadme({
  plugin,
  onClose,
  triggerId,
}: {
  plugin: CatalogPlugin | null
  onClose: () => void
  triggerId: string | null
}) {
  const { t } = useTranslation()
  const readme = usePluginReadme(plugin)

  return (
    <Dialog
      open={plugin !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (triggerId) document.getElementById(triggerId)?.focus()
        }}
      >
        <DialogHeader className="shrink-0 border-b p-5 pr-12 text-left">
          <DialogTitle className="text-balance">{plugin?.name}</DialogTitle>
          <DialogDescription className="text-pretty tabular-nums">
            README · {plugin?.version}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto p-5">
          {readme.isLoading && (
            <div
              role="status"
              aria-label={t('plugins.loadingReadme')}
              className="space-y-3"
            >
              <Skeleton className="h-7 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}
          {readme.error && (
            <div className="space-y-3">
              <p role="alert" className="text-pretty text-sm text-destructive">
                {t('plugins.readmeFailed')}: {readme.error.message}
              </p>
              <Button variant="outline" onClick={() => void readme.refetch()}>
                {t('plugins.retry')}
              </Button>
            </div>
          )}
          {readme.isSuccess &&
            (readme.data.readme ? (
              <div className="ai-markdown max-w-none overflow-x-auto text-pretty text-sm text-foreground/80 [font-family:var(--font-sans)]">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  skipHtml
                  urlTransform={(url) => {
                    const safeUrl = defaultUrlTransform(url)
                    if (!safeUrl) return ''
                    try {
                      return new URL(safeUrl, readme.data.baseUrl).href
                    } catch {
                      return ''
                    }
                  }}
                  components={{
                    a: ({ children, ...props }) => (
                      <a {...props} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    ),
                    img: (props) => (
                      <img
                        {...props}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ),
                  }}
                >
                  {readme.data.readme}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-pretty text-sm text-muted-foreground">
                {t('plugins.noReadme')}
              </p>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
