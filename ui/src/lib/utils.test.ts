import type { NodeCondition } from 'kubernetes-types/core/v1'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PodMetrics } from '@/types/api'

import {
  debounce,
  enrichNodeConditionsWithHealth,
  formatBytes,
  formatChartXTicks,
  formatCPU,
  formatDate,
  formatMemory,
  formatPodMetrics,
  getAge,
  parseBytes,
  parseRBACError,
  translateError,
} from './utils'

function createStorage() {
  let store: Record<string, string> = {}

  return {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key)
        ? store[key]
        : null
    },
    setItem(key: string, value: string) {
      store[key] = value
    },
    removeItem(key: string) {
      delete store[key]
    },
    clear() {
      store = {}
    },
  }
}

vi.stubGlobal('localStorage', createStorage())
vi.stubGlobal('sessionStorage', createStorage())

afterEach(() => {
  vi.restoreAllMocks()
})

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('invokes only the latest call', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('first')
    debounced('second')

    vi.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('second')
  })

  it('cancels a pending invocation', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('value')
    debounced.cancel()

    vi.advanceTimersByTime(100)

    expect(fn).not.toHaveBeenCalled()
  })
})

describe('time formatting helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-03T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['2 days ago', '2024-01-01T12:00:00Z', '2d'],
    ['3 hours ago', '2024-01-03T09:00:00Z', '3h'],
    ['15 minutes ago', '2024-01-03T11:45:00Z', '15m'],
    ['30 seconds ago', '2024-01-03T11:59:30Z', '30s'],
  ])('formats age for %s', (_label, timestamp, expected) => {
    expect(getAge(timestamp)).toBe(expected)
  })

  it('formats a timestamp using the app date format', () => {
    expect(formatDate('2024-01-03T12:34:56Z')).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
    )
  })

  it('passes the expected options to locale formatting', () => {
    const spy = vi
      .spyOn(Date.prototype, 'toLocaleString')
      .mockReturnValue('formatted')

    expect(formatChartXTicks('2024-01-03T12:34:56Z', true)).toBe('formatted')
    expect(spy).toHaveBeenCalledWith(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })

    spy.mockClear()

    expect(formatChartXTicks('2024-01-03T12:34:56Z', false)).toBe('formatted')
    expect(spy).toHaveBeenCalledWith(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  })
})

describe('size and resource formatting helpers', () => {
  it('formats byte values and parses Kubernetes byte strings', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1.5 KiB')
    expect(parseBytes('2Gi')).toBe(2 * 1024 ** 3)
    expect(parseBytes('123')).toBe(123)
  })

  it('formats CPU and memory values', () => {
    expect(formatCPU('250m')).toBe('0.250 cores')
    expect(formatCPU(2)).toBe('2 cores')
    expect(formatMemory(1024)).toBe('1 KiB')
    expect(formatMemory('1.5Gi')).toBe('1.5 GiB')
  })

  it('formats pod metrics into aggregate CPU and memory values', () => {
    const metrics = {
      containers: [
        { usage: { cpu: '250m', memory: '1Mi' } },
        { usage: { cpu: '500000000n', memory: '512Ki' } },
      ],
    }

    expect(formatPodMetrics(metrics as unknown as PodMetrics)).toEqual({
      cpu: 250.5,
      memory: 1_572_864,
    })
  })
})

describe('RBAC helpers', () => {
  it('parses namespace RBAC errors', () => {
    expect(
      parseRBACError(
        'user alice does not have permission to get pods in namespace default on cluster cluster-a'
      )
    ).toEqual({
      user: 'alice',
      verb: 'get',
      resource: 'pods',
      namespace: 'default',
      cluster: 'cluster-a',
    })
  })

  it('translates RBAC and non-RBAC errors', () => {
    const t = vi.fn((key: string, options?: Record<string, string>) => {
      if (key === 'rbac.verb.get') {
        return 'read'
      }
      if (key === 'nav.pods') {
        return 'Pods'
      }
      if (key === 'rbac.noPermissionNamespace') {
        return [
          options?.user,
          options?.verb,
          options?.resource,
          options?.namespace,
          options?.cluster,
        ].join('|')
      }
      if (key === 'common.error') {
        return `common:${options?.error}`
      }
      return key
    })

    expect(
      translateError(
        new Error(
          'user alice does not have permission to get pods in namespace All on cluster cluster-a'
        ),
        t
      )
    ).toBe('alice|read|Pods|All|cluster-a')

    expect(translateError(new Error('boom'), t)).toBe('boom')
    expect(translateError({ reason: 'nope' }, t)).toBe('common:[object Object]')
  })
})

describe('enrichNodeConditionsWithHealth', () => {
  it('reverses pressure-related conditions and preserves others', () => {
    const conditions = [
      { type: 'DiskPressure', status: 'True' },
      { type: 'MemoryPressure', status: 'False' },
      { type: 'Ready', status: 'True' },
      { type: 'NetworkUnavailable', status: 'Unknown' },
    ] as NodeCondition[]

    expect(enrichNodeConditionsWithHealth(conditions)).toEqual([
      { type: 'DiskPressure', status: 'True', health: 'False' },
      { type: 'MemoryPressure', status: 'False', health: 'True' },
      { type: 'Ready', status: 'True', health: 'True' },
      { type: 'NetworkUnavailable', status: 'Unknown', health: 'Unknown' },
    ])
  })
})
