import { render, screen } from '@testing-library/react'
import { beforeEach, vi } from 'vitest'

import { ProtectedRoute } from './protected-route'

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

const { mockNavigate, mockUseLocation, mockUseAuth } = vi.hoisted(() => ({
  mockNavigate: vi.fn(() => null),
  mockUseLocation: vi.fn(),
  mockUseAuth: vi.fn(),
}))

vi.mock('@/contexts/auth-context', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom')

  return {
    ...actual,
    Navigate: mockNavigate,
    useLocation: mockUseLocation,
  }
})

describe('ProtectedRoute', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockUseLocation.mockReturnValue({
      pathname: '/private',
      search: '',
      hash: '',
      state: null,
      key: 'test',
    })
  })

  it('shows the loading state while auth is resolving', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: true,
    })

    const { container } = render(<ProtectedRoute>secret</ProtectedRoute>)

    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(screen.queryByText('secret')).not.toBeInTheDocument()
  })

  it('redirects unauthenticated users to the login page', () => {
    const location = {
      pathname: '/private',
      search: '',
      hash: '',
      state: null,
      key: 'test',
    }

    mockUseLocation.mockReturnValue(location)
    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
    })

    render(<ProtectedRoute>secret</ProtectedRoute>)

    expect(mockNavigate.mock.calls[0]?.[0]).toMatchObject({
      to: '/login',
      replace: true,
      state: { from: location },
    })
    expect(screen.queryByText('secret')).not.toBeInTheDocument()
  })

  it('renders children for authenticated users', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '1' },
      isLoading: false,
    })

    render(<ProtectedRoute>secret</ProtectedRoute>)

    expect(screen.getByText('secret')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
