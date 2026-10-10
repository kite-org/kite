import { useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, Sparkle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import './ai-chat.css'

export function AIChatThinking({
  content,
  isThinking,
}: {
  content?: string
  isThinking: boolean
}) {
  const { t } = useTranslation()
  const traceId = useId()
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const followLatestRef = useRef(true)
  const expanded = manualExpanded ?? isThinking

  useLayoutEffect(() => {
    const container = contentRef.current
    if (container && expanded && isThinking && followLatestRef.current) {
      container.scrollTop = container.scrollHeight
    }
  }, [content, expanded, isThinking])

  const label = (
    <>
      <Sparkle className="size-4 shrink-0 fill-current stroke-0" />
      <span role="status" className={isThinking ? 'ai-thinking-shimmer' : ''}>
        {t(isThinking ? 'aiChat.thinking' : 'aiChat.thoughtProcess')}
      </span>
    </>
  )

  if (!content) {
    return (
      <div className="flex items-center gap-2 py-1 text-[13px] font-medium text-muted-foreground">
        {label}
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={traceId}
        onClick={() => setManualExpanded(!expanded)}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-md px-1.5 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        <ChevronDown
          className={`size-3.5 transition-transform duration-300 motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      <div
        id={traceId}
        aria-hidden={!expanded}
        className={`grid transition-[grid-template-rows,opacity] duration-300 motion-reduce:transition-none ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
      >
        <div className="overflow-hidden">
          <div
            ref={contentRef}
            role="region"
            aria-label={t('aiChat.thoughtProcess')}
            tabIndex={expanded ? 0 : -1}
            onScroll={(event) => {
              const container = event.currentTarget
              followLatestRef.current =
                container.scrollHeight -
                  container.scrollTop -
                  container.clientHeight <=
                2
            }}
            className="mb-2 ml-[7px] max-h-40 overflow-y-auto overscroll-contain border-l py-2 pr-2 pl-5 text-[13px] leading-6 text-muted-foreground wrap-break-word whitespace-pre-wrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {content}
          </div>
        </div>
      </div>
    </div>
  )
}
