import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { ResourceType } from '@/types/api'
import { deleteResource } from '@/lib/api'
import {
  getResourceListPath,
  getResourceSingularLabel,
} from '@/lib/resource-metadata'
import { translateError } from '@/lib/utils'

import { DeleteConfirmationDialog } from './delete-confirmation-dialog'

interface ResourceDeleteConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  resourceName: string
  resourceType: ResourceType
  namespace?: string
  additionalNote?: string
}

export function ResourceDeleteConfirmationDialog({
  open,
  onOpenChange,
  resourceName,
  resourceType,
  namespace,
  additionalNote,
}: ResourceDeleteConfirmationDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const navigate = useNavigate()
  const { t } = useTranslation()

  const handleDelete = async (force?: boolean, wait?: boolean) => {
    setIsDeleting(true)
    try {
      await deleteResource(resourceType, resourceName, namespace, {
        force,
        wait,
      })
      toast.success(
        `${getResourceSingularLabel(resourceType) || resourceType} deleted successfully`
      )
      navigate(getResourceListPath(resourceType))
    } catch (error) {
      toast.error(translateError(error, t))
    } finally {
      setIsDeleting(false)
      onOpenChange(false)
    }
  }

  return (
    <DeleteConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      resourceName={resourceName}
      resourceType={resourceType}
      onConfirm={handleDelete}
      isDeleting={isDeleting}
      namespace={namespace}
      additionalNote={additionalNote}
      showAdditionalOptions={true}
    />
  )
}
