import * as yaml from 'js-yaml'

import { getResourceSingular } from '@/lib/resource-metadata'

export function toSingularResource(resource: string) {
  return getResourceSingular(resource) || resource.toLowerCase()
}

export function describeAction(
  tool: string,
  args: Record<string, unknown>
): string {
  const kind = (args.kind as string) || ''
  const name = (args.name as string) || ''
  const ns = (args.namespace as string) || ''
  const target = ns ? `${kind} ${ns}/${name}` : `${kind} ${name}`

  switch (tool) {
    case 'delete_resource':
      return `Delete ${target}`
    case 'patch_resource': {
      const patch = args.patch as string | undefined
      if (patch) {
        try {
          const obj = JSON.parse(patch)
          if (obj?.spec?.replicas !== undefined) {
            return `Scale ${target} to ${obj.spec.replicas} replicas`
          }
          const anno =
            obj?.spec?.template?.metadata?.annotations?.[
              'kubectl.kubernetes.io/restartedAt'
            ]
          if (anno) {
            return `Restart ${target}`
          }
        } catch {
          // ignore
        }
        return `Patch ${target}: ${patch.length > 80 ? `${patch.slice(0, 80)}...` : patch}`
      }
      return `Patch ${target}`
    }
    case 'create_resource': {
      const yaml = (args.yaml as string) || ''
      const kindMatch = yaml.match(/^kind:\s*(.+)$/m)
      const nameMatch = yaml.match(/^\s*name:\s*(.+)$/m)
      if (kindMatch && nameMatch) {
        return `Create ${kindMatch[1].trim()} ${nameMatch[1].trim()}`
      }
      return 'Create resource'
    }
    case 'update_resource': {
      const yaml = (args.yaml as string) || ''
      const kindMatch = yaml.match(/^kind:\s*(.+)$/m)
      const nameMatch = yaml.match(/^\s*name:\s*(.+)$/m)
      if (kindMatch && nameMatch) {
        return `Update ${kindMatch[1].trim()} ${nameMatch[1].trim()}`
      }
      return 'Update resource'
    }
    default:
      return tool
  }
}

export function buildToolYamlPreview(
  tool: string | undefined,
  args: Record<string, unknown> | undefined
): string | null {
  if (!tool || !args) {
    return null
  }

  switch (tool) {
    case 'create_resource':
    case 'update_resource': {
      const resourceYaml = args.yaml
      return typeof resourceYaml === 'string' && resourceYaml.trim()
        ? resourceYaml.trim()
        : null
    }
    case 'patch_resource': {
      const patch = args.patch
      if (typeof patch !== 'string' || !patch.trim()) {
        return null
      }

      try {
        const metadata: Record<string, string> = {}
        if (typeof args.name === 'string' && args.name.trim()) {
          metadata.name = args.name.trim()
        }
        if (typeof args.namespace === 'string' && args.namespace.trim()) {
          metadata.namespace = args.namespace.trim()
        }

        const preview: Record<string, unknown> = {
          patch: JSON.parse(patch),
        }
        if (typeof args.kind === 'string' && args.kind.trim()) {
          preview.kind = args.kind.trim()
        }
        if (Object.keys(metadata).length > 0) {
          preview.metadata = metadata
        }

        return yaml
          .dump(preview, {
            indent: 2,
            lineWidth: -1,
            noRefs: true,
          })
          .trim()
      } catch {
        return patch.trim()
      }
    }
    default:
      return null
  }
}

export function buildInputDefaults(
  inputRequest:
    | {
        fields?: Array<{
          name: string
          type: 'text' | 'number' | 'textarea' | 'select' | 'switch'
          defaultValue?: string
        }>
      }
    | undefined
): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {}
  for (const field of inputRequest?.fields || []) {
    if (field.type === 'switch') {
      values[field.name] = field.defaultValue === 'true'
      continue
    }
    values[field.name] = field.defaultValue || ''
  }
  return values
}
