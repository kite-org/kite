import { useEffect, type KeyboardEvent, type RefObject } from 'react'
import { Send, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

const MAX_INPUT_HEIGHT = 220

export function AIChatComposer({
  value,
  isLoading,
  onChange,
  onSend,
  onStop,
  onKeyDown,
  inputRef,
}: {
  value: string
  isLoading: boolean
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  inputRef: RefObject<HTMLTextAreaElement | null>
}) {
  const { t } = useTranslation()

  useEffect(() => {
    const textarea = inputRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_INPUT_HEIGHT)}px`
    textarea.style.overflowY =
      textarea.scrollHeight > MAX_INPUT_HEIGHT ? 'auto' : 'hidden'
  }, [inputRef, value])

  return (
    <div className="shrink-0 border-t p-2">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          className="flex-1 min-w-0 resize-none rounded-md border bg-background px-3 py-2 text-base leading-5 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
          placeholder="Ask about your cluster..."
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={isLoading}
        />
        {isLoading ? (
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 shrink-0"
            onClick={onStop}
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={onSend}
            disabled={!value.trim()}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <p className="mt-1 text-center text-[10px] leading-4 text-muted-foreground">
        {t('aiChat.disclaimer')}
      </p>
    </div>
  )
}
