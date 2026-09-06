/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { KubeconfigDownloadDialog } from './kubeconfig-download-dialog'

const { useCluster } = vi.hoisted(() => ({
  useCluster: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      defaultValue?: string,
      values?: Record<string, string | number>
    ) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replace(`{{${key}}}`, String(value)),
        defaultValue ?? _key
      ),
  }),
}))

vi.mock('@/lib/api', () => ({
  downloadKubeconfig: vi.fn(),
}))

vi.mock('@/hooks/use-cluster', () => ({ useCluster }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const clusters = [
  { uuid: 'current-id', name: 'current', enabled: true },
  { uuid: 'other-id', name: 'other', enabled: true },
  { uuid: 'disabled-id', name: 'disabled', enabled: false },
]

function renderDialog() {
  const onOpenChange = vi.fn()
  render(<KubeconfigDownloadDialog open onOpenChange={onOpenChange} />)
  return onOpenChange
}

function mockClusters() {
  useCluster.mockReturnValue({
    clusters,
    currentCluster: 'current',
    refreshClusters: vi.fn(),
  })
}

describe('KubeconfigDownloadDialog', () => {
  it('refreshes clusters when opened', () => {
    const refreshClusters = vi.fn()
    useCluster.mockReturnValue({
      clusters,
      currentCluster: 'current',
      refreshClusters,
    })

    renderDialog()

    expect(refreshClusters).toHaveBeenCalledOnce()
  })

  it('defaults to the current cluster and supports selecting all clusters', async () => {
    mockClusters()
    renderDialog()
    const user = userEvent.setup()

    expect(screen.getByText('1 selected / 2 total')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /current/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^other$/i })).not.toBeChecked()
    expect(screen.queryByText('disabled')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Select all' }))

    expect(screen.getByText('2 selected / 2 total')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /current/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^other$/i })).toBeChecked()
    expect(
      screen.getByRole('button', { name: 'Deselect all' })
    ).toBeInTheDocument()
  })

  it('selects only matching clusters while preserving hidden selections', async () => {
    mockClusters()
    renderDialog()
    const user = userEvent.setup()
    const search = screen.getByPlaceholderText('Search clusters')

    await user.type(search, 'other')

    expect(
      screen.getByRole('button', { name: 'Select matching' })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Select matching' }))
    await user.clear(search)

    expect(screen.getByRole('checkbox', { name: /current/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^other$/i })).toBeChecked()
  })

  it('deselects only matching clusters while preserving hidden selections', async () => {
    mockClusters()
    renderDialog()
    const user = userEvent.setup()
    const search = screen.getByPlaceholderText('Search clusters')

    await user.click(screen.getByRole('button', { name: 'Select all' }))
    await user.type(search, 'other')

    expect(
      screen.getByRole('button', { name: 'Deselect matching' })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Deselect matching' }))
    await user.clear(search)

    expect(screen.getByRole('checkbox', { name: /current/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^other$/i })).not.toBeChecked()
  })

  it('disables matching selection and shows an empty state when no clusters match', async () => {
    mockClusters()
    renderDialog()
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText('Search clusters'), 'missing')

    expect(
      screen.getByRole('button', { name: 'Select matching' })
    ).toBeDisabled()
    expect(screen.getByText('No matching clusters found.')).toBeInTheDocument()
  })

  it('renders concise expiration presets', () => {
    mockClusters()
    renderDialog()

    for (const preset of ['1d', '7d', '30d', '1year']) {
      expect(screen.getByRole('button', { name: preset })).toBeInTheDocument()
    }
  })

  it('uses selectors for a custom expiration time', async () => {
    mockClusters()
    renderDialog()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Custom' }))

    for (const field of ['year', 'month', 'day', 'hour', 'minute', 'second']) {
      expect(screen.getByRole('combobox', { name: field })).toBeInTheDocument()
    }
    expect(
      screen.queryByRole('textbox', { name: 'second' })
    ).not.toBeInTheDocument()
  })
})
