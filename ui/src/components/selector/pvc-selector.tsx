import { ResourceSelect } from './resource-select'

export function PVCSelector({
  selectedPVC,
  onPVCChange,
  namespace,
  placeholder = 'Select a pvc',
  className,
}: {
  selectedPVC?: string
  onPVCChange: (pvc: string) => void
  namespace?: string
  placeholder?: string
  className?: string
}) {
  return (
    <ResourceSelect
      resourceType="persistentvolumeclaims"
      value={selectedPVC}
      onChange={onPVCChange}
      namespace={namespace}
      placeholder={placeholder}
      className={className}
    />
  )
}
