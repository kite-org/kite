import { useEffect, useState } from 'react'
import {
  IconLink,
  IconMail,
  IconMessage,
  IconRobot,
  IconSettings,
  IconTerminal2,
} from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  GeneralSettingUpdateRequest,
  testSMTPSetting,
  updateGeneralSetting,
  useBootstrap,
  useGeneralSetting,
} from '@/lib/api'
import { translateError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5'
const DEFAULT_KUBECTL_IMAGE = 'zzde/kubectl:latest'
const DEFAULT_NODE_TERMINAL_IMAGE = 'busybox:latest'
const DEFAULT_CLUSTER_AGENT_IMAGE = 'ghcr.io/kite-org/kite:latest'

interface SMTPSettingsFormData {
  smtpEnabled: boolean
  smtpHost: string
  smtpPort: number
  smtpUsername: string
  smtpPassword: string
  smtpPasswordConfigured: boolean
  smtpFromEmail: string
  smtpFromName: string
  smtpEncryption: 'none' | 'starttls' | 'tls'
  smtpSkipTLSVerify: boolean
  smtpTimeoutSeconds: number
  testRecipient: string
}

interface GeneralSettingsFormData {
  aiAgentEnabled: boolean
  aiProvider: 'openai' | 'anthropic'
  aiModel: string
  aiApiKey: string
  aiApiKeyConfigured: boolean
  aiBaseUrl: string
  aiMaxTokens: number
  kubectlEnabled: boolean
  kubectlImage: string
  nodeTerminalImage: string
  clusterAgentImage: string
  enableAnalytics: boolean
  enableVersionCheck: boolean
  loginPrompt: string
}

export function GeneralManagement() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data, isLoading } = useGeneralSetting()
  const { data: bootstrap } = useBootstrap()
  const smtpManaged = bootstrap?.managedSections?.smtp ?? false
  const [smtpFormData, setSMTPFormData] = useState<SMTPSettingsFormData>({
    smtpEnabled: false,
    smtpHost: '',
    smtpPort: 587,
    smtpUsername: '',
    smtpPassword: '',
    smtpPasswordConfigured: false,
    smtpFromEmail: '',
    smtpFromName: '',
    smtpEncryption: 'starttls',
    smtpSkipTLSVerify: false,
    smtpTimeoutSeconds: 30,
    testRecipient: '',
  })
  const [formData, setFormData] = useState<GeneralSettingsFormData>({
    aiAgentEnabled: false,
    aiProvider: 'openai',
    aiModel: DEFAULT_MODEL,
    aiApiKey: '',
    aiApiKeyConfigured: false,
    aiBaseUrl: '',
    aiMaxTokens: 16384,
    kubectlEnabled: true,
    kubectlImage: DEFAULT_KUBECTL_IMAGE,
    nodeTerminalImage: DEFAULT_NODE_TERMINAL_IMAGE,
    clusterAgentImage: DEFAULT_CLUSTER_AGENT_IMAGE,
    enableAnalytics: true,
    enableVersionCheck: true,
    loginPrompt: '',
  })

  useEffect(() => {
    if (!data) return
    setSMTPFormData((prev) => ({
      ...prev,
      smtpEnabled: data.smtpEnabled ?? false,
      smtpHost: data.smtpHost || '',
      smtpPort: data.smtpPort || 587,
      smtpUsername: data.smtpUsername || '',
      smtpPassword: '',
      smtpPasswordConfigured: data.smtpPasswordConfigured ?? false,
      smtpFromEmail: data.smtpFromEmail || '',
      smtpFromName: data.smtpFromName || '',
      smtpEncryption: data.smtpEncryption || 'starttls',
      smtpSkipTLSVerify: data.smtpSkipTLSVerify ?? false,
      smtpTimeoutSeconds: data.smtpTimeoutSeconds || 30,
    }))
    setFormData({
      aiAgentEnabled: data.aiAgentEnabled,
      aiProvider: data.aiProvider || 'openai',
      aiModel: data.aiModel || DEFAULT_MODEL,
      aiApiKey: '',
      aiApiKeyConfigured: data.aiApiKeyConfigured ?? false,
      aiBaseUrl: data.aiBaseUrl || '',
      aiMaxTokens: data.aiMaxTokens || 16384,
      kubectlEnabled: data.kubectlEnabled ?? true,
      kubectlImage: data.kubectlImage || DEFAULT_KUBECTL_IMAGE,
      nodeTerminalImage: data.nodeTerminalImage || DEFAULT_NODE_TERMINAL_IMAGE,
      clusterAgentImage: data.clusterAgentImage || DEFAULT_CLUSTER_AGENT_IMAGE,
      enableAnalytics: data.enableAnalytics ?? false,
      enableVersionCheck: data.enableVersionCheck ?? true,
      loginPrompt: data.loginPrompt || '',
    })
  }, [data])

  const mutation = useMutation({
    mutationFn: (payload: GeneralSettingUpdateRequest) =>
      updateGeneralSetting(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'general-setting' ||
          query.queryKey[0] === 'ai-status' ||
          query.queryKey[0] === 'bootstrap',
      })
      toast.success(
        t('generalManagement.messages.updated', 'General settings updated')
      )
    },
    onError: (error) => {
      toast.error(translateError(error, t))
    },
  })

  const smtpTestMutation = useMutation({
    mutationFn: testSMTPSetting,
    onSuccess: () => {
      toast.success(
        t(
          'generalManagement.smtp.messages.testSent',
          'Test email sent. Click Save at the bottom of the page to persist SMTP settings.'
        )
      )
    },
    onError: (error) => {
      toast.error(translateError(error, t))
    },
  })

  const validateSMTPForm = () => {
    if (smtpFormData.smtpEnabled && !smtpFormData.smtpHost.trim()) {
      toast.error(
        t('generalManagement.smtp.errors.hostRequired', 'SMTP host is required')
      )
      return false
    }
    if (smtpFormData.smtpEnabled && !smtpFormData.smtpFromEmail.trim()) {
      toast.error(
        t(
          'generalManagement.smtp.errors.fromEmailRequired',
          'From email is required'
        )
      )
      return false
    }
    return true
  }

  const handleSMTPTest = () => {
    if (!smtpFormData.testRecipient.trim()) {
      toast.error(
        t(
          'generalManagement.smtp.errors.recipientRequired',
          'Recipient email is required'
        )
      )
      return
    }
    if (!validateSMTPForm()) return

    const payload = {
      recipient: smtpFormData.testRecipient.trim(),
      smtpEnabled: smtpFormData.smtpEnabled,
      smtpHost: smtpFormData.smtpHost.trim(),
      smtpPort: smtpFormData.smtpPort || 587,
      smtpUsername: smtpFormData.smtpUsername.trim(),
      smtpFromEmail: smtpFormData.smtpFromEmail.trim(),
      smtpFromName: smtpFormData.smtpFromName.trim(),
      smtpEncryption: smtpFormData.smtpEncryption,
      smtpSkipTLSVerify: smtpFormData.smtpSkipTLSVerify,
      smtpTimeoutSeconds: smtpFormData.smtpTimeoutSeconds || 30,
    }
    if (smtpFormData.smtpPassword.trim()) {
      Object.assign(payload, { smtpPassword: smtpFormData.smtpPassword })
    }
    smtpTestMutation.mutate(payload)
  }

  const handleSave = () => {
    const defaultModel =
      formData.aiProvider === 'anthropic'
        ? DEFAULT_ANTHROPIC_MODEL
        : DEFAULT_MODEL

    if (formData.aiAgentEnabled && !formData.aiModel.trim()) {
      toast.error(
        t('generalManagement.errors.modelRequired', 'Model is required')
      )
      return
    }
    if (
      formData.aiAgentEnabled &&
      !formData.aiApiKey.trim() &&
      !formData.aiApiKeyConfigured
    ) {
      toast.error(
        t(
          'generalManagement.errors.apiKeyRequired',
          'API Key is required when AI Agent is enabled'
        )
      )
      return
    }
    if (formData.kubectlEnabled && !formData.kubectlImage.trim()) {
      toast.error(
        t(
          'generalManagement.errors.kubectlImageRequired',
          'Kubectl image is required when kubectl is enabled'
        )
      )
      return
    }
    if (!formData.nodeTerminalImage.trim()) {
      toast.error(
        t(
          'generalManagement.errors.nodeTerminalImageRequired',
          'Node terminal image is required'
        )
      )
      return
    }
    if (!smtpManaged && !validateSMTPForm()) return

    const payload: GeneralSettingUpdateRequest = {
      aiAgentEnabled: formData.aiAgentEnabled,
      aiProvider: formData.aiProvider,
      aiModel: formData.aiModel.trim() || defaultModel,
      aiBaseUrl: formData.aiBaseUrl.trim(),
      aiMaxTokens: formData.aiMaxTokens || 16384,
      kubectlEnabled: formData.kubectlEnabled,
      kubectlImage: formData.kubectlImage.trim() || DEFAULT_KUBECTL_IMAGE,
      nodeTerminalImage:
        formData.nodeTerminalImage.trim() || DEFAULT_NODE_TERMINAL_IMAGE,
      clusterAgentImage:
        formData.clusterAgentImage.trim() || DEFAULT_CLUSTER_AGENT_IMAGE,
      enableAnalytics: formData.enableAnalytics,
      enableVersionCheck: formData.enableVersionCheck,
      loginPrompt: formData.loginPrompt.trim(),
    }
    if (formData.aiApiKey.trim()) {
      payload.aiApiKey = formData.aiApiKey.trim()
    }
    if (!smtpManaged) {
      Object.assign(payload, {
        smtpEnabled: smtpFormData.smtpEnabled,
        smtpHost: smtpFormData.smtpHost.trim(),
        smtpPort: smtpFormData.smtpPort || 587,
        smtpUsername: smtpFormData.smtpUsername.trim(),
        smtpFromEmail: smtpFormData.smtpFromEmail.trim(),
        smtpFromName: smtpFormData.smtpFromName.trim(),
        smtpEncryption: smtpFormData.smtpEncryption,
        smtpSkipTLSVerify: smtpFormData.smtpSkipTLSVerify,
        smtpTimeoutSeconds: smtpFormData.smtpTimeoutSeconds || 30,
      })
      if (smtpFormData.smtpPassword.trim()) {
        payload.smtpPassword = smtpFormData.smtpPassword
      }
    }

    mutation.mutate(payload)
  }

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">
          {t('common.messages.loading', 'Loading...')}
        </div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconSettings className="h-5 w-5" />
          {t('generalManagement.title', 'General')}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-lg border">
          <div className="flex items-center justify-between p-3">
            <div className="space-y-1">
              <Label className="flex items-center gap-2 text-sm font-medium">
                <IconRobot className="h-4 w-4" />
                {t('generalManagement.aiAgent.title', 'AI Agent')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t(
                  'generalManagement.aiAgent.description',
                  'Enable AI assistant and configure model endpoint.'
                )}
              </p>
            </div>
            <Switch
              checked={formData.aiAgentEnabled}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({ ...prev, aiAgentEnabled: checked }))
              }
            />
          </div>

          {formData.aiAgentEnabled && (
            <div className="space-y-4 border-t p-3">
              <div className="space-y-2">
                <Label htmlFor="general-ai-provider">
                  {t('common.fields.provider', 'Provider')}
                </Label>
                <Select
                  value={formData.aiProvider}
                  onValueChange={(value: 'openai' | 'anthropic') =>
                    setFormData((prev) => ({
                      ...prev,
                      aiProvider: value,
                      aiModel:
                        value === 'anthropic'
                          ? prev.aiModel || DEFAULT_ANTHROPIC_MODEL
                          : prev.aiModel || DEFAULT_MODEL,
                    }))
                  }
                >
                  <SelectTrigger id="general-ai-provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI Compatible</SelectItem>
                    <SelectItem value="anthropic">
                      Anthropic Compatible
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="general-ai-model">
                  {t('generalManagement.aiAgent.form.model', 'Model')}
                </Label>
                <Input
                  id="general-ai-model"
                  value={formData.aiModel}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      aiModel: e.target.value,
                    }))
                  }
                  placeholder={
                    formData.aiProvider === 'anthropic'
                      ? DEFAULT_ANTHROPIC_MODEL
                      : DEFAULT_MODEL
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="general-ai-api-key">
                  {t('generalManagement.aiAgent.form.apiKey', 'API Key')}
                </Label>
                <Input
                  id="general-ai-api-key"
                  type="password"
                  value={formData.aiApiKey}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      aiApiKey: e.target.value,
                    }))
                  }
                  placeholder={
                    formData.aiApiKeyConfigured
                      ? t(
                          'generalManagement.aiAgent.form.apiKeyPlaceholder',
                          'Leave empty to keep current API Key'
                        )
                      : 'sk-...'
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="general-ai-base-url">
                  {t('generalManagement.aiAgent.form.baseUrl', 'Base URL')}
                </Label>
                <Input
                  id="general-ai-base-url"
                  value={formData.aiBaseUrl}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      aiBaseUrl: e.target.value,
                    }))
                  }
                  placeholder={
                    formData.aiProvider === 'anthropic'
                      ? 'https://api.anthropic.com'
                      : 'https://api.openai.com/v1'
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="general-ai-max-tokens">
                  {t('generalManagement.aiAgent.form.maxTokens', 'Max Tokens')}
                </Label>
                <Input
                  id="general-ai-max-tokens"
                  type="number"
                  min="1"
                  max="128000"
                  value={formData.aiMaxTokens}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      aiMaxTokens: parseInt(e.target.value) || 16384,
                    }))
                  }
                  placeholder="16384"
                />
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border">
          <div className="flex items-center justify-between p-3">
            <div className="space-y-1">
              <Label className="flex items-center gap-2 text-sm font-medium">
                <IconMail className="h-4 w-4" />
                {t('generalManagement.smtp.title', 'SMTP')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t(
                  'generalManagement.smtp.description',
                  'Configure email delivery for notifications.'
                )}
              </p>
            </div>
            <Switch
              aria-label={t('generalManagement.smtp.toggle', 'Enable SMTP')}
              checked={smtpFormData.smtpEnabled}
              disabled={smtpManaged}
              onCheckedChange={(checked) =>
                setSMTPFormData((prev) => ({ ...prev, smtpEnabled: checked }))
              }
            />
          </div>

          {smtpManaged && (
            <p className="border-t px-3 pt-3 text-xs text-muted-foreground">
              {t(
                'generalManagement.smtp.managed',
                'Managed by configuration file and cannot be modified here.'
              )}
            </p>
          )}

          {smtpFormData.smtpEnabled && (
            <>
              <div className="space-y-4 border-t p-3">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="smtp-host">
                      {t('generalManagement.smtp.form.host', 'Host')}
                    </Label>
                    <Input
                      id="smtp-host"
                      value={smtpFormData.smtpHost}
                      disabled={smtpManaged}
                      onChange={(e) =>
                        setSMTPFormData((prev) => ({
                          ...prev,
                          smtpHost: e.target.value,
                        }))
                      }
                      placeholder="smtp.example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-port">
                      {t('generalManagement.smtp.form.port', 'Port')}
                    </Label>
                    <Input
                      id="smtp-port"
                      type="number"
                      min="1"
                      max="65535"
                      value={smtpFormData.smtpPort}
                      disabled={smtpManaged}
                      onChange={(e) =>
                        setSMTPFormData((prev) => ({
                          ...prev,
                          smtpPort: parseInt(e.target.value) || 587,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-username">
                      {t('generalManagement.smtp.form.username', 'Username')}
                    </Label>
                    <Input
                      id="smtp-username"
                      value={smtpFormData.smtpUsername}
                      disabled={smtpManaged}
                      onChange={(e) =>
                        setSMTPFormData((prev) => ({
                          ...prev,
                          smtpUsername: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-password">
                      {t('generalManagement.smtp.form.password', 'Password')}
                    </Label>
                    <Input
                      id="smtp-password"
                      type="password"
                      value={smtpFormData.smtpPassword}
                      disabled={smtpManaged}
                      onChange={(e) =>
                        setSMTPFormData((prev) => ({
                          ...prev,
                          smtpPassword: e.target.value,
                        }))
                      }
                      placeholder={
                        smtpFormData.smtpPasswordConfigured
                          ? t(
                              'generalManagement.smtp.form.passwordPlaceholder',
                              'Leave empty to keep current password'
                            )
                          : undefined
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-from-email">
                      {t('generalManagement.smtp.form.fromEmail', 'From Email')}
                    </Label>
                    <Input
                      id="smtp-from-email"
                      type="email"
                      value={smtpFormData.smtpFromEmail}
                      disabled={smtpManaged}
                      onChange={(e) =>
                        setSMTPFormData((prev) => ({
                          ...prev,
                          smtpFromEmail: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-from-name">
                      {t('generalManagement.smtp.form.fromName', 'From Name')}
                    </Label>
                    <Input
                      id="smtp-from-name"
                      value={smtpFormData.smtpFromName}
                      disabled={smtpManaged}
                      onChange={(e) =>
                        setSMTPFormData((prev) => ({
                          ...prev,
                          smtpFromName: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor="smtp-encryption">
                      {t(
                        'generalManagement.smtp.form.encryption',
                        'Encryption'
                      )}
                    </Label>
                    <Select
                      value={smtpFormData.smtpEncryption}
                      disabled={smtpManaged}
                      onValueChange={(value: 'none' | 'starttls' | 'tls') =>
                        setSMTPFormData((prev) => ({
                          ...prev,
                          smtpEncryption: value,
                        }))
                      }
                    >
                      <SelectTrigger id="smtp-encryption">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="starttls">STARTTLS</SelectItem>
                        <SelectItem value="tls">TLS</SelectItem>
                        <SelectItem value="none">
                          {t('generalManagement.smtp.encryption.none', 'None')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <div className="flex h-10 w-full items-center justify-between gap-2">
                      <Label htmlFor="smtp-skip-tls-verify" className="text-sm">
                        {t(
                          'generalManagement.smtp.form.skipTLSVerify',
                          'Skip TLS certificate verification'
                        )}
                      </Label>
                      <Switch
                        id="smtp-skip-tls-verify"
                        checked={smtpFormData.smtpSkipTLSVerify}
                        disabled={smtpManaged}
                        onCheckedChange={(checked) =>
                          setSMTPFormData((prev) => ({
                            ...prev,
                            smtpSkipTLSVerify: checked,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="smtp-timeout">
                      {t(
                        'generalManagement.smtp.form.timeout',
                        'Timeout (seconds)'
                      )}
                    </Label>
                    <Input
                      id="smtp-timeout"
                      type="number"
                      min="1"
                      value={smtpFormData.smtpTimeoutSeconds}
                      disabled={smtpManaged}
                      onChange={(e) =>
                        setSMTPFormData((prev) => ({
                          ...prev,
                          smtpTimeoutSeconds: parseInt(e.target.value) || 30,
                        }))
                      }
                    />
                  </div>
                </div>

                {(smtpFormData.smtpEncryption === 'none' ||
                  smtpFormData.smtpSkipTLSVerify) && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {t(
                      'generalManagement.smtp.securityHint',
                      'This configuration may transmit email credentials or content insecurely.'
                    )}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2 border-t p-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="w-full space-y-2 sm:max-w-sm">
                  <Label htmlFor="smtp-test-recipient">
                    {t(
                      'generalManagement.smtp.form.testRecipient',
                      'Test recipient'
                    )}
                  </Label>
                  <Input
                    id="smtp-test-recipient"
                    type="email"
                    value={smtpFormData.testRecipient}
                    onChange={(e) =>
                      setSMTPFormData((prev) => ({
                        ...prev,
                        testRecipient: e.target.value,
                      }))
                    }
                  />
                </div>
                <Button
                  onClick={handleSMTPTest}
                  disabled={
                    !smtpFormData.smtpEnabled || smtpTestMutation.isPending
                  }
                  variant="outline"
                >
                  {t('generalManagement.smtp.actions.test', 'Send test email')}
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="rounded-lg border">
          <div className="flex items-center justify-between p-3">
            <div className="space-y-1">
              <Label className="flex items-center gap-2 text-sm font-medium">
                <IconTerminal2 className="h-4 w-4" />
                {t('generalManagement.kubectl.title', 'Kubectl')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t(
                  'generalManagement.kubectl.description',
                  'Enable kubectl terminal and configure runtime image.'
                )}
              </p>
            </div>
            <Switch
              aria-label={t(
                'generalManagement.kubectl.toggle',
                'Enable kubectl'
              )}
              checked={formData.kubectlEnabled}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({ ...prev, kubectlEnabled: checked }))
              }
            />
          </div>

          {formData.kubectlEnabled && (
            <div className="space-y-2 border-t p-3">
              <Label htmlFor="general-kubectl-image">
                {t('generalManagement.kubectl.form.image', 'Image')}
              </Label>
              <Input
                id="general-kubectl-image"
                value={formData.kubectlImage}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    kubectlImage: e.target.value,
                  }))
                }
                placeholder={DEFAULT_KUBECTL_IMAGE}
              />
            </div>
          )}
        </div>

        <div className="rounded-lg border p-3">
          <div className="space-y-1">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <IconTerminal2 className="h-4 w-4" />
              {t('generalManagement.nodeTerminal.title', 'Node Terminal')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t(
                'generalManagement.nodeTerminal.description',
                'Configure runtime image used for node terminal sessions.'
              )}
            </p>
          </div>

          <div className="mt-3 space-y-2">
            <Label htmlFor="general-node-terminal-image">
              {t('generalManagement.nodeTerminal.form.image', 'Image')}
            </Label>
            <Input
              id="general-node-terminal-image"
              value={formData.nodeTerminalImage}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  nodeTerminalImage: e.target.value,
                }))
              }
              placeholder={DEFAULT_NODE_TERMINAL_IMAGE}
            />
          </div>
        </div>

        <div className="rounded-lg border p-3">
          <div className="space-y-1">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <IconLink className="h-4 w-4" />
              {t('generalManagement.clusterAgent.title', 'Cluster Agent Image')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t(
                'generalManagement.clusterAgent.description',
                'Container image used when generating the Cluster Agent manifest for Cluster Agent clusters.'
              )}
            </p>
          </div>

          <div className="mt-3 space-y-2">
            <Label htmlFor="general-cluster-agent-image">
              {t('generalManagement.clusterAgent.form.image', 'Image')}
            </Label>
            <Input
              id="general-cluster-agent-image"
              value={formData.clusterAgentImage}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  clusterAgentImage: e.target.value,
                }))
              }
              placeholder={DEFAULT_CLUSTER_AGENT_IMAGE}
            />
          </div>
        </div>

        <div className="rounded-lg border">
          <div className="p-3">
            <Label className="text-sm font-medium">
              {t('generalManagement.runtime.title', 'Runtime')}
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                'generalManagement.runtime.description',
                'Configure analytics and version checking behavior.'
              )}
            </p>
          </div>

          <div className="flex items-center justify-between border-t p-3">
            <Label htmlFor="general-enable-analytics" className="text-sm">
              {t(
                'generalManagement.runtime.form.enableAnalytics',
                'Enable analytics'
              )}
            </Label>
            <Switch
              id="general-enable-analytics"
              checked={formData.enableAnalytics}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({ ...prev, enableAnalytics: checked }))
              }
            />
          </div>

          <div className="flex items-center justify-between border-t p-3">
            <Label htmlFor="general-enable-version-check" className="text-sm">
              {t(
                'generalManagement.runtime.form.enableVersionCheck',
                'Enable version check'
              )}
            </Label>
            <Switch
              id="general-enable-version-check"
              checked={formData.enableVersionCheck}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({
                  ...prev,
                  enableVersionCheck: checked,
                }))
              }
            />
          </div>
        </div>

        <div className="rounded-lg border p-3">
          <div className="space-y-1">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <IconMessage className="h-4 w-4" />
              {t('generalManagement.loginPrompt.title', 'Login Prompt')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t(
                'generalManagement.loginPrompt.description',
                'Show a custom message on the login page.'
              )}
            </p>
          </div>

          <div className="mt-3 space-y-2">
            <Label htmlFor="general-login-prompt">
              {t('generalManagement.loginPrompt.form.message', 'Message')}
            </Label>
            <Textarea
              id="general-login-prompt"
              value={formData.loginPrompt}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  loginPrompt: e.target.value,
                }))
              }
              placeholder={t(
                'generalManagement.loginPrompt.form.placeholder',
                'Leave empty to hide the login prompt'
              )}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={mutation.isPending}>
            {t('common.actions.save', 'Save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
