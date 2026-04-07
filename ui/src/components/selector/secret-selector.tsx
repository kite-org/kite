import { useCallback } from 'react'

import { ResourceSelect } from './resource-select'

export function SecretSelector({
  selectedSecret,
  onSecretChange,
  namespace,
  placeholder = 'Select a secret',
  className,
  avoidHelmSecrets = false,
}: {
  selectedSecret?: string
  onSecretChange: (secret: string) => void
  namespace?: string
  placeholder?: string
  className?: string
  avoidHelmSecrets?: boolean
}) {
  const filter = useCallback(
    (item: { type?: string }) =>
      !avoidHelmSecrets || !item.type?.includes('helm.sh/release.v1'),
    [avoidHelmSecrets]
  )

  return (
    <ResourceSelect
      resourceType="secrets"
      value={selectedSecret}
      onChange={onSecretChange}
      namespace={namespace}
      placeholder={placeholder}
      className={className}
      filter={avoidHelmSecrets ? filter : undefined}
    />
  )
}
