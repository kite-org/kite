import { ResourceSelect } from './resource-select'

export function ConfigMapSelector({
  selectedConfigMap,
  onConfigMapChange,
  namespace,
  placeholder = 'Select a configmap',
  className,
}: {
  selectedConfigMap?: string
  onConfigMapChange: (configMap: string) => void
  namespace?: string
  placeholder?: string
  className?: string
}) {
  return (
    <ResourceSelect
      resourceType="configmaps"
      value={selectedConfigMap}
      onChange={onConfigMapChange}
      namespace={namespace}
      placeholder={placeholder}
      className={className}
    />
  )
}
