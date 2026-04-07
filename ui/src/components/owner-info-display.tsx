import { ObjectMeta } from 'kubernetes-types/meta/v1'
import { Link } from 'react-router-dom'

import { getOwnerInfo } from '@/lib/k8s'
import { Label } from '@/components/ui/label'

export function OwnerInfoDisplay({ metadata }: { metadata?: ObjectMeta }) {
  const ownerInfo = getOwnerInfo(metadata)
  if (!ownerInfo) return null

  return (
    <div>
      <Label className="text-xs text-muted-foreground">Owner</Label>
      <p className="text-sm">
        <Link to={ownerInfo.path} className="app-link">
          {ownerInfo.kind}/{ownerInfo.name}
        </Link>
      </p>
    </div>
  )
}
