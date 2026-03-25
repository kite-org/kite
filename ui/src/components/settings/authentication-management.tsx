import { useEffect, useState } from 'react'
import { IconKey } from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  LDAPSetting,
  LDAPSettingUpdateRequest,
  updateLDAPSetting,
  useLDAPSetting,
} from '@/lib/api'
import { translateError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

import { OAuthProviderManagement } from './oauth-provider-management'

type AuthenticationFormData = LDAPSetting

function createDefaultSettings(): AuthenticationFormData {
  return {
    enabled: false,
    serverUrl: '',
    useStartTLS: false,
    bindDn: '',
    bindPassword: '',
    bindPasswordConfigured: false,
    userBaseDn: '',
    userFilter: '',
    usernameAttribute: '',
    displayNameAttribute: '',
    groupBaseDn: '',
    groupFilter: '',
    groupNameAttribute: '',
  }
}

function toFormData(data?: LDAPSetting): AuthenticationFormData {
  if (!data) {
    return createDefaultSettings()
  }

  return {
    enabled: data.enabled ?? false,
    serverUrl: data.serverUrl || '',
    useStartTLS: data.useStartTLS ?? false,
    bindDn: data.bindDn || '',
    bindPassword: '',
    bindPasswordConfigured: data.bindPasswordConfigured ?? false,
    userBaseDn: data.userBaseDn || '',
    userFilter: data.userFilter || '',
    usernameAttribute: data.usernameAttribute || '',
    displayNameAttribute: data.displayNameAttribute || '',
    groupBaseDn: data.groupBaseDn || '',
    groupFilter: data.groupFilter || '',
    groupNameAttribute: data.groupNameAttribute || '',
  }
}

export function AuthenticationManagement() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data, error, isError, isLoading, refetch } = useLDAPSetting()
  const [formData, setFormData] = useState<AuthenticationFormData>(
    createDefaultSettings
  )

  useEffect(() => {
    setFormData(toFormData(data))
  }, [data])

  const mutation = useMutation({
    mutationFn: updateLDAPSetting,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['ldap-setting'],
      })
      toast.success(
        t(
          'authenticationManagement.messages.updated',
          'Authentication settings updated'
        )
      )
    },
    onError: (error) => {
      toast.error(translateError(error, t))
    },
  })

  const handleSave = () => {
    if (!data) {
      toast.error(
        isError
          ? translateError(error, t)
          : t(
              'authenticationManagement.errors.loadFailed',
              'Failed to load LDAP settings'
            )
      )
      return
    }

    const payload: LDAPSettingUpdateRequest = {
      enabled: formData.enabled,
      serverUrl: formData.serverUrl.trim(),
      useStartTLS: formData.useStartTLS,
      bindDn: formData.bindDn.trim(),
      userBaseDn: formData.userBaseDn.trim(),
      userFilter: formData.userFilter.trim(),
      usernameAttribute: formData.usernameAttribute.trim(),
      displayNameAttribute: formData.displayNameAttribute.trim(),
      groupBaseDn: formData.groupBaseDn.trim(),
      groupFilter: formData.groupFilter.trim(),
      groupNameAttribute: formData.groupNameAttribute.trim(),
    }
    if (formData.bindPassword !== '') {
      payload.bindPassword = formData.bindPassword
    }

    mutation.mutate(payload)
  }

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">
          {t('common.loading', 'Loading...')}
        </div>
      </div>
    )
  }

  if (isError && !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconKey className="h-5 w-5" />
            {t('authenticationManagement.title', 'Authentication')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="text-sm text-muted-foreground">
            {translateError(error, t)}
          </div>
          <Button variant="outline" onClick={() => refetch()}>
            {t('common.retry', 'Retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconKey className="h-5 w-5" />
            {t('authenticationManagement.title', 'Authentication')}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="rounded-lg border">
            <div className="flex items-center justify-between p-3">
              <div className="space-y-1">
                <Label className="text-sm font-medium">
                  {t('authenticationManagement.ldap.title', 'LDAP')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'authenticationManagement.ldap.description',
                    'Enable LDAP username/password login and sync groups into RBAC.'
                  )}
                </p>
              </div>
              <Switch
                checked={formData.enabled}
                onCheckedChange={(checked) =>
                  setFormData((prev) => ({ ...prev, enabled: checked }))
                }
              />
            </div>

            {formData.enabled && (
              <div className="space-y-4 border-t p-3">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="ldap-server-url">
                      {t(
                        'authenticationManagement.ldap.form.serverUrl',
                        'Server URL'
                      )}
                    </Label>
                    <Input
                      id="ldap-server-url"
                      value={formData.serverUrl}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          serverUrl: e.target.value,
                        }))
                      }
                      placeholder="ldaps://ldap.example.com:636"
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <div className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div>
                        <Label htmlFor="ldap-starttls" className="text-sm">
                          {t(
                            'authenticationManagement.ldap.form.useStartTLS',
                            'Use StartTLS'
                          )}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {t(
                            'authenticationManagement.ldap.form.useStartTLSHint',
                            'Enable StartTLS when using ldap:// endpoints.'
                          )}
                        </p>
                      </div>
                      <Switch
                        id="ldap-starttls"
                        checked={formData.useStartTLS}
                        onCheckedChange={(checked) =>
                          setFormData((prev) => ({
                            ...prev,
                            useStartTLS: checked,
                          }))
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ldap-bind-dn">
                      {t(
                        'authenticationManagement.ldap.form.bindDn',
                        'Bind DN'
                      )}
                    </Label>
                    <Input
                      id="ldap-bind-dn"
                      value={formData.bindDn}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          bindDn: e.target.value,
                        }))
                      }
                      placeholder="cn=svc-kite,ou=services,dc=example,dc=com"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ldap-bind-password">
                      {t(
                        'authenticationManagement.ldap.form.bindPassword',
                        'Bind Password'
                      )}
                    </Label>
                    <Input
                      id="ldap-bind-password"
                      type="password"
                      value={formData.bindPassword}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          bindPassword: e.target.value,
                        }))
                      }
                      placeholder={
                        formData.bindPasswordConfigured
                          ? t(
                              'authenticationManagement.ldap.form.bindPasswordPlaceholder',
                              'Leave empty to keep current bind password'
                            )
                          : ''
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ldap-user-base-dn">
                      {t(
                        'authenticationManagement.ldap.form.userBaseDn',
                        'User Base DN'
                      )}
                    </Label>
                    <Input
                      id="ldap-user-base-dn"
                      value={formData.userBaseDn}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          userBaseDn: e.target.value,
                        }))
                      }
                      placeholder="ou=users,dc=example,dc=com"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ldap-user-filter">
                      {t(
                        'authenticationManagement.ldap.form.userFilter',
                        'User Filter'
                      )}
                    </Label>
                    <Input
                      id="ldap-user-filter"
                      value={formData.userFilter}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          userFilter: e.target.value,
                        }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ldap-username-attribute">
                      {t(
                        'authenticationManagement.ldap.form.usernameAttribute',
                        'Username Attribute'
                      )}
                    </Label>
                    <Input
                      id="ldap-username-attribute"
                      value={formData.usernameAttribute}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          usernameAttribute: e.target.value,
                        }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ldap-display-name-attribute">
                      {t(
                        'authenticationManagement.ldap.form.displayNameAttribute',
                        'Display Name Attribute'
                      )}
                    </Label>
                    <Input
                      id="ldap-display-name-attribute"
                      value={formData.displayNameAttribute}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          displayNameAttribute: e.target.value,
                        }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ldap-group-base-dn">
                      {t(
                        'authenticationManagement.ldap.form.groupBaseDn',
                        'Group Base DN'
                      )}
                    </Label>
                    <Input
                      id="ldap-group-base-dn"
                      value={formData.groupBaseDn}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          groupBaseDn: e.target.value,
                        }))
                      }
                      placeholder="ou=groups,dc=example,dc=com"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ldap-group-filter">
                      {t(
                        'authenticationManagement.ldap.form.groupFilter',
                        'Group Filter'
                      )}
                    </Label>
                    <Input
                      id="ldap-group-filter"
                      value={formData.groupFilter}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          groupFilter: e.target.value,
                        }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ldap-group-name-attribute">
                      {t(
                        'authenticationManagement.ldap.form.groupNameAttribute',
                        'Group Name Attribute'
                      )}
                    </Label>
                    <Input
                      id="ldap-group-name-attribute"
                      value={formData.groupNameAttribute}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          groupNameAttribute: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={mutation.isPending}>
              {t('common.save', 'Save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <OAuthProviderManagement />
    </div>
  )
}
