import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

interface DeleteConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  resourceName: string
  resourceType: string
  onConfirm: (force?: boolean, wait?: boolean) => void
  isDeleting?: boolean
  namespace?: string
  additionalNote?: string
  showAdditionalOptions?: boolean
}

export function DeleteConfirmationDialog({
  open,
  onOpenChange,
  resourceName,
  resourceType,
  onConfirm,
  isDeleting,
  namespace,
  additionalNote,
  showAdditionalOptions = false,
}: DeleteConfirmationDialogProps) {
  const { t } = useTranslation()
  const [confirmationInput, setConfirmationInput] = useState('')
  const [forceDelete, setForceDelete] = useState(false)
  const [wait, setWait] = useState(true)

  const handleDialogChange = (open: boolean) => {
    if (!open) {
      setConfirmationInput('')
      setForceDelete(false)
    }
    onOpenChange(open)
  }

  const handleConfirm = () => {
    if (confirmationInput === resourceName) {
      onConfirm(forceDelete, wait)
    }
  }

  const isConfirmDisabled = confirmationInput !== resourceName || isDeleting

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-left">
                {t('deleteConfirmation.title', { type: resourceType })}
              </DialogTitle>
              <DialogDescription className="text-left">
                {t('deleteConfirmation.description')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {additionalNote && (
            <p className="mt-2 text-muted-foreground">{additionalNote}</p>
          )}
          <div className="rounded-lg bg-destructive/5 p-4 border border-destructive/20">
            <div className="text-sm">
              <p className="font-medium text-destructive mb-2">
                {t('deleteConfirmation.aboutToDelete')}
              </p>
              <div className="space-y-1 text-muted-foreground">
                <p>
                  <span className="font-medium">
                    {t('common.fields.name')}:
                  </span>{' '}
                  {resourceName}
                </p>
                <p>
                  <span className="font-medium">
                    {t('deleteConfirmation.type')}:
                  </span>{' '}
                  {resourceType}
                </p>
                {namespace && (
                  <p>
                    <span className="font-medium">
                      {t('common.fields.namespace')}:
                    </span>{' '}
                    {namespace}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmation">
              {t('deleteConfirmation.typeToConfirm')}{' '}
              <span className=" font-semibold">{resourceName}</span>{' '}
              {t('deleteConfirmation.toConfirm')}
            </Label>
            <Input
              id="confirmation"
              value={confirmationInput}
              onChange={(e) => setConfirmationInput(e.target.value)}
              placeholder={resourceName}
              autoComplete="off"
            />
          </div>
          {showAdditionalOptions && (
            <>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="wait"
                  checked={wait}
                  onCheckedChange={(checked) => setWait(checked === true)}
                />
                <label
                  htmlFor="wait"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  {t('deleteConfirmation.wait')}
                </label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="force-delete"
                  checked={forceDelete}
                  onCheckedChange={(checked) =>
                    setForceDelete(checked === true)
                  }
                />
                <label
                  htmlFor="force-delete"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  {t('deleteConfirmation.forceDelete')}
                </label>
              </div>
              <p className="text-xs text-muted-foreground ml-6 -mt-2">
                {t('deleteConfirmation.finalizerNote')}
              </p>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleDialogChange(false)}
            disabled={isDeleting}
          >
            {t('common.actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isConfirmDisabled}
          >
            {isDeleting
              ? t('deleteConfirmation.deleting')
              : t('common.actions.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
