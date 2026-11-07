import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { KeyValueForm } from './deployment-form'

interface KeyValueEditorProps {
  title: string
  addLabel: string
  entries: KeyValueForm[]
  onChange: (entries: KeyValueForm[]) => void
  minItems?: number
  keyPlaceholder?: string
  valuePlaceholder?: string
}

export function KeyValueEditor({
  title,
  addLabel,
  entries,
  onChange,
  minItems = 0,
  keyPlaceholder,
  valuePlaceholder,
}: KeyValueEditorProps) {
  const { t } = useTranslation()

  const updateEntry = (
    index: number,
    field: keyof KeyValueForm,
    value: string
  ) => {
    onChange(
      entries.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry
      )
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Label>{title}</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...entries, { key: '', value: '' }])}
        >
          <Plus data-icon="inline-start" />
          {addLabel}
        </Button>
      </div>

      {entries.map((entry, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={entry.key}
            placeholder={
              keyPlaceholder || t('deployments.podConfiguration.key')
            }
            aria-label={`${title} ${index + 1} key`}
            onChange={(event) => updateEntry(index, 'key', event.target.value)}
          />
          <Input
            value={entry.value}
            placeholder={
              valuePlaceholder || t('deployments.podConfiguration.value')
            }
            aria-label={`${title} ${index + 1} value`}
            onChange={(event) =>
              updateEntry(index, 'value', event.target.value)
            }
          />
          {entries.length > minItems && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`${t('common.actions.remove')} ${title} ${index + 1}`}
              onClick={() =>
                onChange(
                  entries.filter((_, entryIndex) => entryIndex !== index)
                )
              }
            >
              <Trash2 />
            </Button>
          )}
        </div>
      ))}
    </section>
  )
}
