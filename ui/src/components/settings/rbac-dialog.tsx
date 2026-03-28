import { useEffect, useState } from 'react'
import { IconEdit, IconShieldCheck, IconX } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { Cluster, Role } from '@/types/api'
import { useClusterList } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { Separator } from '../ui/separator'

interface RBACDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  role?: Role | null
  onSubmit: (data: Partial<Role>) => void
}

export function RBACDialog({
  open,
  onOpenChange,
  role,
  onSubmit,
}: RBACDialogProps) {
  const { t } = useTranslation()
  const isEdit = !!role

  const [form, setForm] = useState<Partial<Role>>({
    name: '',
    description: '',
    clusters: [],
    namespaces: [],
    resources: [],
    verbs: [],
  })

  useEffect(() => {
    if (role) {
      setForm(role)
    }
  }, [role, open])

  const handleChange = (field: keyof Role, value: string) =>
    setForm((prev) => ({ ...(prev || {}), [field]: value }))

  const setArrayField = (
    field: 'clusters' | 'namespaces' | 'resources' | 'verbs',
    items: string[]
  ) => {
    setForm((prev) => ({ ...(prev || {}), [field]: items }))
  }

  function ListEditor({
    label,
    items,
    onChange,
    placeholder,
    suggestions,
  }: {
    label: string
    items: string[]
    onChange: (items: string[]) => void
    placeholder?: string
    suggestions?: string[]
  }) {
    const [input, setInput] = useState('')
    const [focused, setFocused] = useState(false)

    const add = () => {
      const v = input.trim()
      if (!v) return
      const next = Array.from(new Set([...items, v]))
      onChange(next)
      setInput('')
    }

    const remove = (val: string) => {
      onChange(items.filter((i) => i !== val))
    }

    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <div className="flex flex-wrap gap-2">
          {items.map((it) => (
            <div
              key={it}
              className="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-sm"
            >
              <span className="select-none">{it}</span>
              <button
                type="button"
                aria-label={`remove ${it}`}
                onClick={() => remove(it)}
                className="inline-flex items-center justify-center"
              >
                <IconX className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        <div className="relative">
          <div className="flex gap-2">
            <Input
              value={input}
              placeholder={placeholder}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                // Delay hiding suggestions to allow suggestion click to register
                setTimeout(() => setFocused(false), 150)
              }}
              required={items.length === 0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  add()
                }
              }}
            />
          </div>

          {/* Dropdown suggestions (if provided) */}
          {focused && suggestions && suggestions.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-popover border rounded shadow max-h-60 overflow-auto">
              {suggestions
                .filter((s) =>
                  s.toLowerCase().includes(input.trim().toLowerCase())
                )
                .filter((s) => !items.includes(s))
                .slice(0, 50)
                .map((s) => (
                  <div
                    key={s}
                    className="px-3 py-2 cursor-pointer hover:bg-accent text-sm"
                    onMouseDown={(e) => {
                      // prevent input blur before click
                      e.preventDefault()
                      const next = Array.from(new Set([...items, s]))
                      onChange(next)
                      setInput('')
                    }}
                  >
                    <span>{s}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Fetch cluster list for suggestions when editing clusters
  const { data: clusterList = [] } = useClusterList()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(form)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-4xl max-h-[90vh] overflow-y-auto sm:!max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? (
              <IconEdit className="h-5 w-5" />
            ) : (
              <IconShieldCheck className="h-5 w-5" />
            )}
            {isEdit
              ? t('rbac.dialog.edit.title', 'Edit Role')
              : t('rbac.dialog.add.title', 'Add Role')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="role-name">
              {t('rbac.form.name.label', 'Role Name')} *
            </Label>
            <Input
              id="role-name"
              value={form.name || ''}
              onChange={(e) => handleChange('name', e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role-desc">
              {t('rbac.form.description.label', 'Description')}
            </Label>
            <Textarea
              id="role-desc"
              value={form.description || ''}
              onChange={(e) => handleChange('description', e.target.value)}
              rows={3}
            />
          </div>
          <Separator />
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-medium">
                {t('rbac.form.permissions.label', 'Permissions')}
              </h3>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ListEditor
                label={t('rbac.form.clusters.label', 'Clusters')}
                items={form.clusters || ['*']}
                onChange={(items) => setArrayField('clusters', items)}
                placeholder="* or cluster-name"
                suggestions={
                  Array.isArray(clusterList)
                    ? (clusterList as Cluster[]).map((c) => c.name)
                    : []
                }
              />

              <ListEditor
                label={t('rbac.form.namespaces.label', 'Namespaces')}
                items={form.namespaces || ['*']}
                onChange={(items) => setArrayField('namespaces', items)}
                placeholder="* or namespace"
              />

              <ListEditor
                label={t('rbac.form.resources.label', 'Resources')}
                items={form.resources || ['*']}
                onChange={(items) => setArrayField('resources', items)}
                placeholder="* or pods,deployments"
              />

              <ListEditor
                label={t('rbac.form.verbs.label', 'Verbs')}
                items={form.verbs || ['*']}
                onChange={(items) => setArrayField('verbs', items)}
                placeholder="* or get,list,create"
                suggestions={[
                  'get',
                  'update',
                  'create',
                  'delete',
                  'log',
                  'exec',
                ]}
              />
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
            <Button type="submit">
              {isEdit ? t('common.save', 'Save') : t('common.create', 'Create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default RBACDialog
