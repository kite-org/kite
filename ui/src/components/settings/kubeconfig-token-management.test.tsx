/// <reference types="@testing-library/jest-dom" />
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { KubeconfigTokenManagement } from './kubeconfig-token-management'

const { deleteAdminKubeconfigToken, useAdminKubeconfigTokens } = vi.hoisted(
  () => ({
    deleteAdminKubeconfigToken: vi.fn(),
    useAdminKubeconfigTokens: vi.fn(),
  })
)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string, values?: Record<string, number>) =>
      defaultValue
        ?.replace('{{page}}', String(values?.page ?? ''))
        .replace('{{totalPages}}', String(values?.totalPages ?? '')) ?? _key,
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/lib/api', () => ({
  deleteAdminKubeconfigToken,
  useAdminKubeconfigTokens,
}))

vi.mock('@/components/kubeconfig-token-list', () => ({
  KubeconfigTokenList: () => <div>Token list</div>,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: ReactNode
    onValueChange: (value: string) => void
    value: string
  }) => (
    <select
      onChange={(event) => onValueChange(event.target.value)}
      value={value}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}))

function renderManagement() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <KubeconfigTokenManagement />
    </QueryClientProvider>
  )
}

describe('KubeconfigTokenManagement', () => {
  it('requests the first page, filters by username and active/expired status, and resets filters to page one', async () => {
    useAdminKubeconfigTokens.mockReturnValue({
      data: { tokens: [], total: 40, page: 1, size: 20 },
      isLoading: false,
      error: null,
    })
    renderManagement()
    const user = userEvent.setup()

    expect(useAdminKubeconfigTokens).toHaveBeenLastCalledWith({
      page: 1,
      size: 20,
      owner: undefined,
      status: undefined,
    })
    expect(
      screen.queryByRole('option', { name: 'Revoked' })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Go to next page' }))
    await waitFor(() => {
      expect(useAdminKubeconfigTokens).toHaveBeenLastCalledWith({
        page: 2,
        size: 20,
        owner: undefined,
        status: undefined,
      })
    })

    await user.type(screen.getByPlaceholderText('Filter by username'), 'alice')
    await waitFor(() => {
      expect(useAdminKubeconfigTokens).toHaveBeenLastCalledWith({
        page: 1,
        size: 20,
        owner: 'alice',
        status: undefined,
      })
    })

    await user.selectOptions(
      screen.getByRole('option', { name: 'Expired' })
        .parentElement as HTMLSelectElement,
      'expired'
    )
    await waitFor(() => {
      expect(useAdminKubeconfigTokens).toHaveBeenLastCalledWith({
        page: 1,
        size: 20,
        owner: 'alice',
        status: 'expired',
      })
    })
  })

  it('enables and disables pagination controls at page boundaries', async () => {
    useAdminKubeconfigTokens.mockReturnValue({
      data: { tokens: [], total: 40, page: 1, size: 20 },
      isLoading: false,
      error: null,
    })
    renderManagement()
    const user = userEvent.setup()

    expect(
      screen.getByRole('button', { name: 'Go to previous page' })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Go to next page' })
    ).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Go to next page' }))
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Go to previous page' })
      ).toBeEnabled()
      expect(
        screen.getByRole('button', { name: 'Go to next page' })
      ).toBeDisabled()
      expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    })
  })
})
