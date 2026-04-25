import { useState } from 'react'
import { IconClipboardText } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { ResourceType } from '@/types/api'
import { useDescribe } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

import { TextViewer } from './text-viewer'
import { Button } from './ui/button'

export function DescribeDialog({
  resourceType,
  namespace,
  name,
}: {
  resourceType: ResourceType
  namespace?: string
  name: string
}) {
  const { t } = useTranslation()
  const [isDescribeOpen, setIsDescribeOpen] = useState(false)
  const { data: describeText } = useDescribe(resourceType, name, namespace, {
    enabled: isDescribeOpen,
    staleTime: 0,
  })
  const title = `kubectl describe ${resourceType} ${namespace ? `-n ${namespace}` : ''} ${name}`
  const description = t('common.describeOutputDescription', {
    resourceType,
    name,
  })

  return (
    <Dialog open={isDescribeOpen} onOpenChange={setIsDescribeOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <IconClipboardText className="w-4 h-4" />
          {t('common.describe')}
        </Button>
      </DialogTrigger>
      <DialogContent className="!max-w-dvw">
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <TextViewer title={title} value={describeText?.result || ''} />
      </DialogContent>
    </Dialog>
  )
}
