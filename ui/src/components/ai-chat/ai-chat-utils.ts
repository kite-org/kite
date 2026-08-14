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
    case 'exec_in_pod': {
      const command = Array.isArray(args.command)
        ? args.command.filter(
            (value): value is string => typeof value === 'string'
          )
        : []
      const container = (args.container as string) || ''
      const pod = ns ? `${ns}/${name}` : name
      const timeout = Number(args.timeout_seconds)
      return `Exec ${JSON.stringify(command)} in Pod ${pod}${container ? ` (${container})` : ''}${timeout > 0 ? `, timeout ${timeout}s` : ''}`
    }
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
    case 'apply_resource': {
      const yaml = (args.yaml as string) || ''
      const kindMatch = yaml.match(/^kind:\s*(.+)$/m)
      const nameMatch = yaml.match(/^\s*name:\s*(.+)$/m)
      if (kindMatch && nameMatch) {
        return `Apply ${kindMatch[1].trim()} ${nameMatch[1].trim()}`
      }
      return 'Apply resource'
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

export function buildToolPreview(
  tool: string | undefined,
  args: Record<string, unknown> | undefined
): { label: string; content: string } | null {
  if (!tool || !args) {
    return null
  }

  switch (tool) {
    case 'exec_in_pod':
      return {
        label: 'Arguments',
        content: JSON.stringify(args, null, 2),
      }
    case 'create_resource':
    case 'apply_resource':
    case 'update_resource': {
      const resourceYaml = args.yaml
      if (typeof resourceYaml !== 'string' || !resourceYaml.trim()) {
        return null
      }
      return { label: 'YAML', content: resourceYaml.trim() }
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

        return {
          label: 'YAML',
          content: yaml
            .dump(preview, {
              indent: 2,
              lineWidth: -1,
              noRefs: true,
            })
            .trim(),
        }
      } catch {
        return { label: 'Patch', content: patch.trim() }
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
