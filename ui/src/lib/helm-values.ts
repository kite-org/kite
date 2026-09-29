import * as yaml from 'js-yaml'
import { isMap, parseDocument } from 'yaml'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Parse values YAML text, keeping the result only when it's a record; returns
// the fallback for empty/non-map/unparsable input so callers get a stable
// object shape for merging and pruning.
export function parseRecordYaml(
  text: string | undefined,
  fallback: Record<string, unknown> = {}
): Record<string, unknown> {
  if (!text) {
    return fallback
  }
  try {
    const parsed = yaml.load(text)
    return isRecord(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

// Values YAML shown in the helm dialogs (prefill and diff baselines) is
// normalized through a key-sorted dump so the diff only highlights real
// changes, never key-order differences between sources.
export function dumpSortedYaml(value: unknown) {
  return yaml.dump(value ?? {}, { indent: 2, sortKeys: true })
}

/**
 * Deep-merge the user's overrides onto chart default values (same-key values
 * are overridden by the user's, helm-style). Arrays are atomic. The upgrade
 * editor shows this full merged result so users see the complete effective
 * configuration.
 */
export function mergeValuesDeep(
  defaults: unknown,
  overrides: unknown
): unknown {
  if (!isRecord(defaults) || !isRecord(overrides)) {
    return overrides === undefined ? defaults : overrides
  }
  const result: Record<string, unknown> = { ...defaults }
  for (const [key, override] of Object.entries(overrides)) {
    result[key] =
      isRecord(override) && isRecord(defaults[key])
        ? mergeValuesDeep(defaults[key], override)
        : override
  }
  return result
}

/**
 * kubeapps-style comment-preserving merge: write the user's overrides into the
 * chart's raw values.yaml text via YAML AST surgery, keeping the file's
 * comments and key order intact. Same-key values are overridden, records
 * recurse only where the document also has a map, arrays are atomic, and keys
 * missing from the document are appended. Returns null when the text cannot
 * be parsed so callers can fall back to {@link mergeValuesDeep}.
 */
export function mergeValuesIntoYamlText(
  defaultsText: string,
  overrides: unknown
): string | null {
  const doc = parseDocument(defaultsText)
  if (doc.errors.length > 0) {
    return null
  }
  if (isRecord(overrides)) {
    const write = (value: unknown, path: string[]) => {
      if (isRecord(value) && isMap(doc.getIn(path))) {
        for (const [key, child] of Object.entries(value)) {
          write(child, [...path, key])
        }
        return
      }
      doc.setIn(path, value)
    }
    for (const [key, child] of Object.entries(overrides)) {
      write(child, [key])
    }
  }
  return doc.toString()
}

function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((item, i) => isDeepEqual(item, b[i]))
    )
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && isDeepEqual(a[key], b[key]))
    )
  }
  return false
}

/**
 * Inverse of {@link mergeValuesDeep}: strip everything that equals the chart
 * defaults so only the minimal override set is submitted to helm. Keeps future
 * chart default changes effective instead of pinning them to old values.
 * Returns undefined when nothing differs.
 */
export function pruneDefaultsDeep(values: unknown, defaults: unknown): unknown {
  if (isRecord(values) && isRecord(defaults)) {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(values)) {
      const pruned =
        key in defaults ? pruneDefaultsDeep(value, defaults[key]) : value
      if (pruned !== undefined) {
        result[key] = pruned
      }
    }
    return Object.keys(result).length > 0 ? result : undefined
  }
  return isDeepEqual(values, defaults) ? undefined : values
}
