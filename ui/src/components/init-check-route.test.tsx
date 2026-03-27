import { render, screen } from '@testing-library/react'
import { beforeEach, vi } from 'vitest'

import { InitCheckRoute } from './init-check-route'

vi.stubGlobal('localStorage', {
  clear: vi.fn(),
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  key: vi.fn(),
  length: 0,
})

vi.stubGlobal('sessionStorage', {
  clear: vi.fn(),
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  key: vi.fn(),
  length: 0,
})

const { mockNavigate, mockUseInitCheck } = vi.hoisted(() => ({
  mockNavigate: vi.fn(() => null),
  mockUseInitCheck: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  useInitCheck: mockUseInitCheck,
}))

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom')

  return {
    ...actual,
    Navigate: mockNavigate,
  }
})

describe('InitCheckRoute', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  it('shows the loading state while the init check is resolving', () => {
    mockUseInitCheck.mockReturnValue({
      data: undefined,
      isLoading: true,
    })

    const { container } = render(<InitCheckRoute>setup</InitCheckRoute>)

    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(screen.queryByText('setup')).not.toBeInTheDocument()
  })

  it('redirects to setup when the app is not initialized', () => {
    mockUseInitCheck.mockReturnValue({
      data: { initialized: false },
      isLoading: false,
    })

    render(<InitCheckRoute>setup</InitCheckRoute>)

    expect(mockNavigate.mock.calls[0]?.[0]).toMatchObject({
      to: '/setup',
      replace: true,
    })
    expect(screen.queryByText('setup')).not.toBeInTheDocument()
  })

  it('renders children when the app is initialized', () => {
    mockUseInitCheck.mockReturnValue({
      data: { initialized: true },
      isLoading: false,
    })

    render(<InitCheckRoute>setup</InitCheckRoute>)

    expect(screen.getByText('setup')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
