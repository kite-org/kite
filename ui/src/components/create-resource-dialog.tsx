import { useState } from 'react'
import { IconLoader2 } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { applyResource, useTemplates } from '@/lib/api'
import { translateError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SimpleYamlEditor } from '@/components/simple-yaml-editor'

interface CreateResourceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateResourceDialog({
  open,
  onOpenChange,
}: CreateResourceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <CreateResourceDialogContent onOpenChange={onOpenChange} />
      ) : null}
    </Dialog>
  )
}

function CreateResourceDialogContent({
  onOpenChange,
}: Omit<CreateResourceDialogProps, 'open'>) {
  const { t } = useTranslation()
  const { data: templates = [] } = useTemplates()
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [yamlContent, setYamlContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleTemplateChange = (templateName: string) => {
    if (templateName === 'empty') {
      setYamlContent('')
      setSelectedTemplateId('')
      return
    }

    const template = templates.find((t) => t.name === templateName)
    if (template) {
      setYamlContent(template.yaml)
      setSelectedTemplateId(template.name)
    }
  }

  const handleApply = async () => {
    if (!yamlContent) return

    setIsLoading(true)
    try {
      await applyResource(yamlContent)
      toast.success(t('common.messages.applied', 'Applied successfully'))
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to apply resource', err)
      toast.error(translateError(err, t))
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    setYamlContent('')
    setSelectedTemplateId('')
    onOpenChange(false)
  }

  return (
    <DialogContent className="!max-w-4xl sm:!max-w-4xl max-h-[80vh] flex flex-col">
      <DialogHeader>
        <DialogTitle>Create Resource</DialogTitle>
        <DialogDescription>
          Paste one or more Kubernetes resource YAML documents and apply them to
          the cluster
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="template">Template</Label>
          <Select
            value={selectedTemplateId || 'empty'}
            onValueChange={handleTemplateChange}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={t(
                  'common.placeholders.selectTemplate',
                  'Select a template'
                )}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="empty">
                {t('common.values.emptyTemplate', 'Empty Template')}
              </SelectItem>
              {templates.map((template) => (
                <SelectItem key={template.name} value={template.name}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="yaml">
            {t('common.fields.yamlConfiguration', 'YAML Configuration')}
          </Label>
          <div className="min-h-[300px] border rounded-md">
            <SimpleYamlEditor
              value={yamlContent}
              onChange={(value) => setYamlContent(value || '')}
              height="400px"
            />
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
          {t('common.actions.cancel', 'Cancel')}
        </Button>
        <Button onClick={handleApply} disabled={isLoading || !yamlContent}>
          {isLoading ? (
            <>
              <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('common.messages.applying', 'Applying...')}
            </>
          ) : (
            t('common.actions.apply', 'Apply')
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
