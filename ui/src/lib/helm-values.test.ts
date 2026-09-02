import { describe, expect, it } from 'vitest'

import {
  mergeValuesDeep,
  mergeValuesIntoYamlText,
  parseRecordYaml,
  pruneDefaultsDeep,
} from './helm-values'

const defaults = {
  replicaCount: 1,
  image: { repository: 'ghcr.io/kite-org/kite', tag: '' },
  podLabels: {},
  tolerations: [] as unknown[],
}

describe('mergeValuesDeep', () => {
  it('overrides same keys and keeps untouched defaults', () => {
    const merged = mergeValuesDeep(defaults, {
      replicaCount: 3,
      podLabels: { mode: 'x' },
    }) as Record<string, unknown>
    expect(merged.replicaCount).toBe(3)
    expect(merged.image).toEqual(defaults.image)
    expect(merged.podLabels).toEqual({ mode: 'x' })
  })

  it('treats arrays as atomic and keeps user-only keys', () => {
    const merged = mergeValuesDeep(defaults, {
      tolerations: [{ key: 'a' }],
      custom: true,
    }) as Record<string, unknown>
    expect(merged.tolerations).toEqual([{ key: 'a' }])
    expect(merged.custom).toBe(true)
  })
})

describe('mergeValuesIntoYamlText', () => {
  const valuesText = [
    '# Number of replicas.',
    'replicaCount: 1',
    'image:',
    '  # Container image repository.',
    '  repository: ghcr.io/kite-org/kite',
    '  tag: ""',
    'podLabels: {}',
    'tolerations: []',
    '',
  ].join('\n')

  it('writes overrides while preserving comments and key order', () => {
    const merged = mergeValuesIntoYamlText(valuesText, {
      replicaCount: 3,
      image: { tag: 'v1' },
    })!
    expect(merged).toContain('# Number of replicas.')
    expect(merged).toContain('# Container image repository.')
    expect(merged).toContain('replicaCount: 3')
    // The yaml lib keeps the original scalar's quoting style (tag: "")
    expect(merged).toContain('tag: "v1"')
    expect(merged.indexOf('replicaCount')).toBeLessThan(
      merged.indexOf('image:')
    )
  })

  it('replaces non-map targets atomically and appends unknown keys', () => {
    const merged = mergeValuesIntoYamlText(valuesText, {
      tolerations: [{ key: 'a' }],
      podLabels: { mode: 'x' },
      custom: true,
    })!
    expect(merged).toContain('key: a')
    expect(merged).toContain('mode: x')
    expect(merged).toContain('custom: true')
  })

  it('returns the text untouched for empty overrides', () => {
    expect(mergeValuesIntoYamlText(valuesText, {})).toBe(valuesText)
  })

  it('returns null for unparsable yaml', () => {
    expect(mergeValuesIntoYamlText('a: [unclosed', { a: 1 })).toBe(null)
  })
})

describe('pruneDefaultsDeep', () => {
  it('is the inverse of mergeValuesDeep for the override set', () => {
    const overrides = {
      replicaCount: 3,
      image: { tag: 'v1' },
      custom: { a: 1 },
    }
    const merged = mergeValuesDeep(defaults, overrides)
    expect(pruneDefaultsDeep(merged, defaults)).toEqual(overrides)
  })

  it('returns undefined when nothing differs from defaults', () => {
    expect(pruneDefaultsDeep(structuredClone(defaults), defaults)).toBe(
      undefined
    )
  })

  it('keeps values whose type differs from the default', () => {
    expect(pruneDefaultsDeep({ podLabels: null }, defaults)).toEqual({
      podLabels: null,
    })
  })
})

describe('parseRecordYaml', () => {
  it('parses a mapping into a record', () => {
    expect(parseRecordYaml('replicaCount: 3')).toEqual({ replicaCount: 3 })
  })

  it('returns the fallback for empty, non-map, or unparsable input', () => {
    const fallback = { a: 1 }
    expect(parseRecordYaml(undefined, fallback)).toBe(fallback)
    expect(parseRecordYaml('', fallback)).toBe(fallback)
    expect(parseRecordYaml('- 1\n- 2', fallback)).toBe(fallback)
    expect(parseRecordYaml('a: [unclosed', fallback)).toBe(fallback)
  })

  it('defaults the fallback to an empty object', () => {
    expect(parseRecordYaml(undefined)).toEqual({})
  })
})
