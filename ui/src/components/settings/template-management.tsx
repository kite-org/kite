import { useMemo, useState } from 'react'
import {
  IconEdit,
  IconPlus,
  IconTemplate,
  IconTrash,
} from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ResourceTemplate } from '@/types/api'
import {
  createTemplate,
  deleteTemplate,
  updateTemplate,
  useTemplates,
} from '@/lib/api'
import { translateError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog'
import { SimpleYamlEditor } from '@/components/simple-yaml-editor'

import { Action, ActionTable } from '../action-table'

export function TemplateManagement() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: templates = [], isLoading } = useTemplates()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] =
    useState<ResourceTemplate | null>(null)
  const [deletingTemplate, setDeletingTemplate] =
    useState<ResourceTemplate | null>(null)

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    yaml: '',
  })

  const createMutation = useMutation({
    mutationFn: (data: Omit<ResourceTemplate, 'id'>) => createTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      toast.success(
        t('common.messages.created', {
          resource: t('common.fields.template', 'Template'),
          defaultValue: 'Template created successfully',
        })
      )
      setIsDialogOpen(false)
    },
    onError: (error) => {
      console.error('Error creating template:', error)
      toast.error(translateError(error, t))
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number
      data: Partial<ResourceTemplate>
    }) => updateTemplate(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      toast.success(
        t('common.messages.updated', {
          resource: t('common.fields.template', 'Template'),
          defaultValue: 'Template updated successfully',
        })
      )
      setIsDialogOpen(false)
    },
    onError: (error) => {
      console.error('Error updating template:', error)
      toast.error(translateError(error, t))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      toast.success(
        t('common.messages.deleted', {
          resource: t('common.fields.template', 'Template'),
          defaultValue: 'Template deleted successfully',
        })
      )
      setDeletingTemplate(null)
    },
    onError: (error) => {
      console.error('Error deleting template:', error)
      toast.error(translateError(error, t))
    },
  })

  const handleOpenDialog = (template?: ResourceTemplate) => {
    if (template) {
      setEditingTemplate(template)
      setFormData({
        name: template.name,
        description: template.description,
        yaml: template.yaml,
      })
    } else {
      setEditingTemplate(null)
      setFormData({
        name: '',
        description: '',
        yaml: '',
      })
    }
    setIsDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (!formData.name || !formData.yaml) {
      toast.error(
        t('common.messages.nameAndYamlRequired', 'Name and YAML are required')
      )
      return
    }

    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, data: formData })
    } else {
      createMutation.mutate(formData)
    }
  }

  const handleDelete = async () => {
    if (!deletingTemplate) return
    deleteMutation.mutate(deletingTemplate.id)
  }

  const columns = useMemo<ColumnDef<ResourceTemplate>[]>(
    () => [
      {
        id: 'name',
        header: t('common.fields.name', 'Name'),
        accessorFn: (row) => row.name,
        cell: ({ row }) => (
          <div className="font-medium">{row.original.name}</div>
        ),
      },
      {
        id: 'description',
        header: t('common.fields.description', 'Description'),
        accessorFn: (row) => row.description,
        cell: ({ row }) => (
          <div className="text-muted-foreground">
            {row.original.description}
          </div>
        ),
      },
    ],
    [t]
  )

  const actions = useMemo<Action<ResourceTemplate>[]>(() => {
    return [
      {
        label: (
          <>
            <IconEdit className="h-4 w-4" />
            {t('common.actions.edit', 'Edit')}
          </>
        ),
        onClick: (item) => handleOpenDialog(item),
      },
      {
        label: (
          <div className="inline-flex items-center gap-2 text-destructive">
            <IconTrash className="h-4 w-4" />
            {t('common.actions.delete', 'Delete')}
          </div>
        ),
        onClick: (item) => setDeletingTemplate(item),
      },
    ]
  }, [t])

  if (isLoading && templates.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">
          {t('common.messages.loading', 'Loading...')}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <IconTemplate className="h-5 w-5" />
                {t('common.fields.templates', 'Templates')}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {t(
                  'common.messages.manageTemplatesDescription',
                  'Manage resource templates for creating new resources.'
                )}
              </p>
            </div>
            <Button onClick={() => handleOpenDialog()} className="gap-2">
              <IconPlus className="h-4 w-4" />
              {t('common.actions.add', 'Add')}{' '}
              {t('common.fields.template', 'Template')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ActionTable data={templates} columns={columns} actions={actions} />
          {templates.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <IconTemplate className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>
                {t('common.messages.noItemsFound', {
                  resource: t('common.fields.templates', 'templates'),
                  defaultValue: 'No templates found',
                })}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-4xl! max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate
                ? `${t('common.actions.edit', 'Edit')} ${t('common.fields.template', 'Template')}`
                : `${t('common.actions.create', 'Create')} ${t('common.fields.template', 'Template')}`}
            </DialogTitle>
            <DialogDescription>
              {editingTemplate
                ? t('common.messages.updateExistingItem', {
                    resource: t('common.fields.template', 'template'),
                    defaultValue: 'Update existing template',
                  })
                : t('common.messages.addNewItem', {
                    resource: t('common.fields.template', 'template'),
                    defaultValue: 'Add a new resource template',
                  })}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-4 overflow-y-auto py-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t('common.fields.name', 'Name')}</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                disabled={!!editingTemplate}
                placeholder="e.g., Pod"
              />
              {editingTemplate && (
                <p className="text-xs text-muted-foreground">
                  {t(
                    'common.messages.nameImmutable',
                    'Name cannot be changed after creation'
                  )}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">
                {t('common.fields.description', 'Description')}
              </Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="e.g., A basic Pod with a single container"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="yaml">
                {t('common.fields.yamlContent', 'YAML Content')}
              </Label>
              <SimpleYamlEditor
                value={formData.yaml}
                onChange={(value) =>
                  setFormData({ ...formData, yaml: value || '' })
                }
                height="400px"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              {t('common.actions.cancel', 'Cancel')}
            </Button>
            <Button onClick={handleSubmit}>
              {t('common.actions.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={!!deletingTemplate}
        onOpenChange={() => setDeletingTemplate(null)}
        onConfirm={handleDelete}
        resourceName={deletingTemplate?.name || ''}
        resourceType="template"
      />
    </div>
  )
}
