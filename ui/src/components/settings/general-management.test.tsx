/// <reference types="@testing-library/jest-dom" />

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GeneralManagement } from './general-management'

const {
  testSMTPSetting,
  updateGeneralSetting,
  useBootstrap,
  useGeneralSetting,
} = vi.hoisted(() => ({
  testSMTPSetting: vi.fn(),
  updateGeneralSetting: vi.fn(),
  useBootstrap: vi.fn(),
  useGeneralSetting: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
  }),
}))

vi.mock('@/lib/api', () => ({
  testSMTPSetting,
  updateGeneralSetting,
  useBootstrap,
  useGeneralSetting,
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const generalSetting = {
  aiAgentEnabled: false,
  aiProvider: 'openai' as const,
  aiModel: 'gpt-4o-mini',
  aiApiKey: '',
  aiApiKeyConfigured: false,
  aiBaseUrl: '',
  aiMaxTokens: 16384,
  smtpEnabled: false,
  smtpHost: '',
  smtpPort: 587,
  smtpUsername: '',
  smtpPasswordConfigured: false,
  smtpFromEmail: '',
  smtpFromName: '',
  smtpEncryption: 'starttls' as const,
  smtpSkipTLSVerify: false,
  smtpTimeoutSeconds: 30,
  kubectlEnabled: true,
  kubectlImage: 'zzde/kubectl:latest',
  nodeTerminalImage: 'busybox:latest',
  clusterAgentImage: 'ghcr.io/kite-org/kite:latest',
  enableAnalytics: true,
  enableVersionCheck: true,
  passwordLoginDisabled: false,
  enableMFA: false,
  enablePasskeyLogin: false,
  loginPrompt: '',
}

function renderManagement(
  setting = generalSetting,
  managedSections: Record<string, boolean> = {}
) {
  useGeneralSetting.mockReturnValue({ data: setting, isLoading: false })
  useBootstrap.mockReturnValue({ data: { managedSections } })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <GeneralManagement />
    </QueryClientProvider>
  )
}

async function enableSMTP(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('switch', { name: 'Enable SMTP' }))
}

describe('GeneralManagement SMTP', () => {
  beforeEach(() => {
    testSMTPSetting.mockReset()
    updateGeneralSetting.mockReset()
  })

  it('renders the SMTP card after AI Agent', () => {
    renderManagement()

    const labels = screen.getAllByText(/^(AI Agent|SMTP)$/)
    expect(labels.map((label) => label.textContent)).toEqual([
      'AI Agent',
      'SMTP',
    ])
  })

  it('shows the SMTP form after enabling SMTP', async () => {
    renderManagement()
    const user = userEvent.setup()

    expect(screen.queryByLabelText('Host')).not.toBeInTheDocument()
    await enableSMTP(user)

    expect(screen.getByLabelText('Host')).toBeInTheDocument()
    expect(screen.getByLabelText('From Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Test recipient')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Send test email' })
    ).toBeInTheDocument()
  })

  it('hides the SMTP test controls while SMTP is disabled', () => {
    renderManagement()

    expect(screen.queryByLabelText('Test recipient')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Send test email' })
    ).not.toBeInTheDocument()
  })

  it('shows the password retention hint when a password is already configured', () => {
    renderManagement({
      ...generalSetting,
      smtpEnabled: true,
      smtpPasswordConfigured: true,
    })

    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'placeholder',
      'Leave empty to keep current password'
    )
  })

  it('renders managed SMTP as read-only while allowing test email', async () => {
    renderManagement(
      {
        ...generalSetting,
        smtpEnabled: true,
        smtpHost: 'smtp.example.com',
        smtpFromEmail: 'sender@example.com',
      },
      { smtp: true }
    )
    const user = userEvent.setup()

    expect(
      screen.getByText(
        'Managed by configuration file and cannot be modified here.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Enable SMTP' })).toBeDisabled()
    expect(screen.getByLabelText('Host')).toBeDisabled()
    expect(screen.getByLabelText('Port')).toBeDisabled()
    expect(screen.getByLabelText('Encryption')).toBeDisabled()
    expect(screen.getByLabelText('Timeout (seconds)')).toBeDisabled()
    expect(screen.getByLabelText('Username')).toBeDisabled()
    expect(screen.getByLabelText('Password')).toBeDisabled()
    expect(screen.getByLabelText('From Email')).toBeDisabled()
    expect(screen.getByLabelText('From Name')).toBeDisabled()
    expect(
      screen.getByLabelText('Skip TLS certificate verification')
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.getByLabelText('Test recipient')).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Send test email' })
    ).toBeEnabled()

    await user.type(
      screen.getByLabelText('Test recipient'),
      'recipient@example.com'
    )
    await user.click(screen.getByRole('button', { name: 'Send test email' }))

    await waitFor(() => {
      expect(testSMTPSetting).toHaveBeenCalled()
    })
    expect(testSMTPSetting.mock.calls[0][0]).toEqual({
      recipient: 'recipient@example.com',
      smtpEnabled: true,
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUsername: '',
      smtpFromEmail: 'sender@example.com',
      smtpFromName: '',
      smtpEncryption: 'starttls',
      smtpSkipTLSVerify: false,
      smtpTimeoutSeconds: 30,
    })
  })

  it('uses the single bottom Save button for SMTP and general settings', async () => {
    updateGeneralSetting.mockResolvedValue(generalSetting)
    renderManagement()
    const user = userEvent.setup()

    await enableSMTP(user)
    await user.type(screen.getByLabelText('Host'), ' smtp.example.com ')
    await user.type(screen.getByLabelText('Username'), ' mailer ')
    await user.type(screen.getByLabelText('Password'), 'secret')
    await user.type(screen.getByLabelText('From Email'), ' sender@example.com ')
    await user.type(screen.getByLabelText('From Name'), ' Kite ')
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateGeneralSetting).toHaveBeenCalledOnce()
    })
    expect(updateGeneralSetting).toHaveBeenCalledWith({
      aiAgentEnabled: false,
      aiProvider: 'openai',
      aiModel: 'gpt-4o-mini',
      aiBaseUrl: '',
      aiMaxTokens: 16384,
      kubectlEnabled: true,
      kubectlImage: 'zzde/kubectl:latest',
      nodeTerminalImage: 'busybox:latest',
      clusterAgentImage: 'ghcr.io/kite-org/kite:latest',
      enableAnalytics: true,
      enableVersionCheck: true,
      loginPrompt: '',
      smtpEnabled: true,
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUsername: 'mailer',
      smtpPassword: 'secret',
      smtpFromEmail: 'sender@example.com',
      smtpFromName: 'Kite',
      smtpEncryption: 'starttls',
      smtpSkipTLSVerify: false,
      smtpTimeoutSeconds: 30,
    })
  })

  it('does not include SMTP fields when SMTP is managed', async () => {
    updateGeneralSetting.mockResolvedValue(generalSetting)
    renderManagement({ ...generalSetting, smtpEnabled: true }, { smtp: true })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateGeneralSetting).toHaveBeenCalledOnce())
    expect(updateGeneralSetting.mock.calls[0][0]).not.toHaveProperty(
      'smtpEnabled'
    )
    expect(updateGeneralSetting.mock.calls[0][0]).not.toHaveProperty('smtpHost')
  })

  it('sends the unsaved SMTP form through testSMTPSetting without updating settings', async () => {
    testSMTPSetting.mockResolvedValue({ message: 'sent' })
    renderManagement()
    const user = userEvent.setup()

    await enableSMTP(user)
    await user.type(screen.getByLabelText('Host'), ' smtp.example.com ')
    await user.type(screen.getByLabelText('Password'), 'temporary-secret')
    await user.type(screen.getByLabelText('From Email'), ' sender@example.com ')
    await user.type(
      screen.getByLabelText('Test recipient'),
      ' recipient@example.com '
    )
    await user.click(screen.getByRole('button', { name: 'Send test email' }))

    await waitFor(() => {
      expect(testSMTPSetting).toHaveBeenCalled()
    })
    expect(testSMTPSetting.mock.calls[0][0]).toEqual({
      recipient: 'recipient@example.com',
      smtpEnabled: true,
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUsername: '',
      smtpPassword: 'temporary-secret',
      smtpFromEmail: 'sender@example.com',
      smtpFromName: '',
      smtpEncryption: 'starttls',
      smtpSkipTLSVerify: false,
      smtpTimeoutSeconds: 30,
    })
    expect(updateGeneralSetting).not.toHaveBeenCalled()
  })
})
