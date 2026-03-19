import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface APIKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: { name: string }) => void
  isLoading?: boolean
}

export function APIKeyDialog({
  open,
  onOpenChange,
  onSubmit,
  isLoading,
}: APIKeyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <APIKeyDialogContent
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
          isLoading={isLoading}
        />
      ) : null}
    </Dialog>
  )
}

function APIKeyDialogContent({
  onOpenChange,
  onSubmit,
  isLoading,
}: Omit<APIKeyDialogProps, 'open'>) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      setError(t('common.required', 'This field is required'))
      return
    }

    onSubmit({ name: name.trim() })
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          {t('apikeyManagement.dialog.title', 'Create API Key')}
        </DialogTitle>
        <DialogDescription>
          {t(
            'apikeyManagement.dialog.description',
            'Create a new API key for programmatic access.'
          )}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit}>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">
              {t('apikeyManagement.dialog.name', 'Name')}
            </Label>
            <Input
              id="name"
              placeholder={t(
                'apikeyManagement.dialog.namePlaceholder',
                'e.g., CI API Key'
              )}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError('')
              }}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading
              ? t('common.creating', 'Creating...')
              : t('common.create', 'Create')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
