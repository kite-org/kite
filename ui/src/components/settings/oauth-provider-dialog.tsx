import { useState } from 'react'
import { IconEdit, IconKey } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { OAuthProvider } from '@/types/api'
import { OAuthProviderCreateRequest } from '@/lib/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

interface OAuthProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider?: OAuthProvider | null
  onSubmit: (providerData: OAuthProviderCreateRequest) => void
}

function createOAuthProviderFormData(provider?: OAuthProvider | null) {
  return {
    name: provider?.name || '',
    clientId: provider?.clientId || '',
    clientSecret: '',
    authUrl: provider?.authUrl || '',
    tokenUrl: provider?.tokenUrl || '',
    userInfoUrl: provider?.userInfoUrl || '',
    scopes: provider?.scopes || 'openid,profile,email',
    issuer: provider?.issuer || '',
    usernameClaim: provider?.usernameClaim || '',
    groupsClaim: provider?.groupsClaim || '',
    allowedGroups: provider?.allowedGroups || '',
    enabled: provider?.enabled ?? true,
  }
}

export function OAuthProviderDialog({
  open,
  onOpenChange,
  provider,
  onSubmit,
}: OAuthProviderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <OAuthProviderDialogContent
          key={provider?.id ?? 'new'}
          provider={provider}
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
        />
      ) : null}
    </Dialog>
  )
}

function OAuthProviderDialogContent({
  provider,
  onOpenChange,
  onSubmit,
}: Omit<OAuthProviderDialogProps, 'open'>) {
  const { t } = useTranslation()
  const isEditMode = !!provider

  const [formData, setFormData] = useState(() =>
    createOAuthProviderFormData(provider)
  )

  const [validationError, setValidationError] = useState('')

  const validateForm = () => {
    const hasIssuer = !!formData.issuer.trim()
    const hasUrls = !!(
      formData.authUrl.trim() &&
      formData.tokenUrl.trim() &&
      formData.userInfoUrl.trim()
    )
    if (!hasIssuer && !hasUrls) {
      setValidationError(
        t(
          'oauthManagement.dialog.validation.issuerOrUrl',
          'Please fill in either Issuer or OAuth URL (Authorization, Token, User Info)'
        )
      )
      return false
    }

    setValidationError('')
    return true
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    const submitData: OAuthProviderCreateRequest = {
      name: formData.name,
      clientId: formData.clientId,
      clientSecret: formData.clientSecret,
      enabled: formData.enabled,
    }

    if (formData.authUrl) submitData.authUrl = formData.authUrl
    if (formData.tokenUrl) submitData.tokenUrl = formData.tokenUrl
    if (formData.userInfoUrl) submitData.userInfoUrl = formData.userInfoUrl
    if (formData.scopes) submitData.scopes = formData.scopes
    if (formData.issuer) submitData.issuer = formData.issuer
    if (formData.usernameClaim)
      submitData.usernameClaim = formData.usernameClaim
    if (formData.groupsClaim) submitData.groupsClaim = formData.groupsClaim
    if (formData.allowedGroups)
      submitData.allowedGroups = formData.allowedGroups

    onSubmit(submitData)
  }

  const handleInputChange =
    (field: keyof typeof formData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFormData((prev) => ({
        ...prev,
        [field]: e.target.value,
      }))
      if (validationError) {
        setValidationError('')
      }
    }

  const handleSwitchChange =
    (field: keyof typeof formData) => (checked: boolean) => {
      setFormData((prev) => ({
        ...prev,
        [field]: checked,
      }))
    }

  return (
    <DialogContent className="!max-w-4xl max-h-[90vh] overflow-y-auto sm:!max-w-4xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {isEditMode ? (
            <IconEdit className="h-5 w-5" />
          ) : (
            <IconKey className="h-5 w-5" />
          )}
          {isEditMode
            ? t('oauthManagement.dialog.editTitle', 'Edit OAuth Provider')
            : t('oauthManagement.dialog.createTitle', 'Add OAuth Provider')}
        </DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Name & Scopes */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-medium">
              {t('oauthManagement.dialog.section.basic', 'Basic Information')}
            </h3>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">
                {t('oauthManagement.dialog.name', 'Name')} *
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={handleInputChange('name')}
                placeholder={t(
                  'oauthManagement.dialog.namePlaceholder',
                  'e.g., github, google'
                )}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scopes">
                {t('oauthManagement.dialog.scopes', 'Scopes')}
              </Label>
              <Input
                id="scopes"
                value={formData.scopes}
                onChange={handleInputChange('scopes')}
                placeholder={t(
                  'oauthManagement.dialog.scopesPlaceholder',
                  'openid,profile,email'
                )}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="client_id">
                {t('oauthManagement.dialog.clientId', 'Client ID')} *
              </Label>
              <Input
                id="client_id"
                value={formData.clientId}
                onChange={handleInputChange('clientId')}
                placeholder={t(
                  'oauthManagement.dialog.clientIdPlaceholder',
                  'OAuth Client ID'
                )}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client_secret">
                {t('oauthManagement.dialog.clientSecret', 'Client Secret')}
                {isEditMode ? '' : ' *'}
              </Label>
              <Input
                id="client_secret"
                type="password"
                value={formData.clientSecret}
                onChange={handleInputChange('clientSecret')}
                placeholder={
                  isEditMode
                    ? t(
                        'oauthManagement.dialog.clientSecretPlaceholder',
                        'Leave empty to keep current secret'
                      )
                    : t(
                        'oauthManagement.dialog.clientSecretRequired',
                        'OAuth Client Secret'
                      )
                }
                required={!isEditMode}
              />
            </div>
          </div>
        </div>
        <Separator />
        {/* Section 2: URLs & Issuer */}
        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-lg font-medium">
              {t('oauthManagement.dialog.section.endpoint', 'OAuth Endpoints')}
            </h3>
          </div>
          <div className="space-y-2">
            <Label htmlFor="issuer">
              {t('oauthManagement.dialog.issuer', 'Issuer')}
            </Label>
            <Input
              id="issuer"
              value={formData.issuer}
              onChange={handleInputChange('issuer')}
              placeholder={t(
                'oauthManagement.dialog.issuerPlaceholder',
                'https://provider.com (auto discovery)'
              )}
            />
          </div>
          <div className="text-center text-sm text-muted-foreground py-2">
            {t('oauthManagement.dialog.or', 'or')}
          </div>
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2">
              <Label htmlFor="authUrl">
                {t('oauthManagement.dialog.authUrl', 'Authorization URL')}
              </Label>
              <Input
                id="authUrl"
                value={formData.authUrl}
                onChange={handleInputChange('authUrl')}
                placeholder={t(
                  'oauthManagement.dialog.authUrlPlaceholder',
                  'https://provider.com/oauth/authorize'
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tokenUrl">
                {t('oauthManagement.dialog.tokenUrl', 'Token URL')}
              </Label>
              <Input
                id="tokenUrl"
                value={formData.tokenUrl}
                onChange={handleInputChange('tokenUrl')}
                placeholder={t(
                  'oauthManagement.dialog.tokenUrlPlaceholder',
                  'https://provider.com/oauth/token'
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="userInfoUrl">
                {t('oauthManagement.dialog.userInfoUrl', 'User Info URL')}
              </Label>
              <Input
                id="userInfoUrl"
                value={formData.userInfoUrl}
                onChange={handleInputChange('userInfoUrl')}
                placeholder={t(
                  'oauthManagement.dialog.userInfoUrlPlaceholder',
                  'https://provider.com/oauth/userinfo'
                )}
              />
            </div>
          </div>
        </div>
        <Separator />
        {/* Section 3: Advanced OIDC Details */}
        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-lg font-medium">
              {t(
                'oauthManagement.dialog.section.advanced',
                'Advanced Settings'
              )}
            </h3>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="usernameClaim">
                {t('oauthManagement.dialog.usernameClaim', 'Username Claim')}
              </Label>
              <Input
                id="usernameClaim"
                value={formData.usernameClaim}
                onChange={handleInputChange('usernameClaim')}
                placeholder={t(
                  'oauthManagement.dialog.usernameClaimPlaceholder',
                  'e.g., preferred_username'
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="groupsClaim">
                {t('oauthManagement.dialog.groupsClaim', 'Groups Claim')}
              </Label>
              <Input
                id="groupsClaim"
                value={formData.groupsClaim}
                onChange={handleInputChange('groupsClaim')}
                placeholder={t(
                  'oauthManagement.dialog.groupsClaimPlaceholder',
                  'e.g., memberOf'
                )}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="allowedGroups">
                {t('oauthManagement.dialog.allowedGroups', 'Allowed Groups')}
              </Label>
              <Input
                id="allowedGroups"
                value={formData.allowedGroups}
                onChange={handleInputChange('allowedGroups')}
                placeholder={t(
                  'oauthManagement.dialog.allowedGroupsPlaceholder',
                  'e.g., admin, developers (comma separated)'
                )}
              />
            </div>
          </div>
        </div>
        <Separator />
        {/* Section 4: Enable */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium">
            {t('oauthManagement.dialog.section.status', 'Status')}
          </h3>
          <div className="flex items-center space-x-2">
            <Switch
              id="enabled"
              checked={formData.enabled}
              onCheckedChange={handleSwitchChange('enabled')}
            />
            <Label htmlFor="enabled">
              {t('oauthManagement.dialog.enabled', 'Enabled')}
            </Label>
          </div>
        </div>
        {validationError && (
          <Alert variant="destructive">
            <AlertDescription>{validationError}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="submit">
            {isEditMode
              ? t('common.update', 'Update')
              : t('common.create', 'Create')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
