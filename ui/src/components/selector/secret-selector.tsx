import { useCallback } from 'react'

import { ResourceSelect } from './resource-select'

export function SecretSelector({
  selectedSecret,
  onSecretChange,
  namespace,
  placeholder = 'Select a secret',
  className,
  avoidHelmSecrets = false,
  allowedTypes,
  excludedSecrets = [],
}: {
  selectedSecret?: string
  onSecretChange: (secret: string) => void
  namespace?: string
  placeholder?: string
  className?: string
  avoidHelmSecrets?: boolean
  allowedTypes?: string[]
  excludedSecrets?: string[]
}) {
  const filter = useCallback(
    (item: { metadata?: { name?: string }; type?: string }) => {
      if (avoidHelmSecrets && item.type?.includes('helm.sh/release.v1')) {
        return false
      }
      if (allowedTypes?.length && !allowedTypes.includes(item.type || '')) {
        return false
      }
      return (
        item.metadata?.name === selectedSecret ||
        !excludedSecrets.includes(item.metadata?.name || '')
      )
    },
    [allowedTypes, avoidHelmSecrets, excludedSecrets, selectedSecret]
  )

  return (
    <ResourceSelect
      resourceType="secrets"
      value={selectedSecret}
      onChange={onSecretChange}
      namespace={namespace}
      placeholder={placeholder}
      className={className}
      filter={
        avoidHelmSecrets || allowedTypes?.length || excludedSecrets.length
          ? filter
          : undefined
      }
    />
  )
}
