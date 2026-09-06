/// <reference types="@testing-library/jest-dom" />
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { KubeconfigTokenList } from './kubeconfig-token-list'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
  }),
}))

const now = new Date('2026-01-01T12:00:00.000Z')
const tokens = [
  {
    id: 1,
    createdAt: '2025-12-01T12:00:00.000Z',
    expiresAt: '2026-02-01T12:00:00.000Z',
    lastUsedAt: '2025-12-31T12:00:00.000Z',
    signingKeyId: 'key-active',
    token: 'secret-active-token',
  },
  {
    id: 2,
    createdAt: '2025-11-01T12:00:00.000Z',
    expiresAt: '2025-12-01T12:00:00.000Z',
    signingKeyId: 'key-expired',
    token: 'secret-expired-token',
  },
]

describe('KubeconfigTokenList', () => {
  it('displays active and expired states without rendering sensitive token values', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    render(<KubeconfigTokenList tokens={tokens} onDelete={vi.fn()} />)

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Expired')).toBeInTheDocument()
    expect(screen.queryByText('Revoked')).not.toBeInTheDocument()
    expect(screen.queryByText('secret-active-token')).not.toBeInTheDocument()
    expect(screen.queryByText('secret-expired-token')).not.toBeInTheDocument()
    expect(screen.queryByText('key-active')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('confirms deleting both active and expired tokens', async () => {
    const onDelete = vi.fn()
    render(<KubeconfigTokenList tokens={tokens} onDelete={onDelete} />)
    const user = userEvent.setup()

    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2)
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[1])
    expect(onDelete).not.toHaveBeenCalled()
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' })
    )
    expect(onDelete).toHaveBeenCalledWith(tokens[1])
  })
})
