import { useEffect, useState } from 'react'
import { IconEdit, IconKey, IconTestPipe } from '@tabler/icons-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { withSubPath } from '@/lib/subpath'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

interface OAuthProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider?: OAuthProvider | null
  onSubmit: (providerData: OAuthProviderCreateRequest) => void
}

export function OAuthProviderDialog({
  open,
  onOpenChange,
  provider,
  onSubmit,
}: OAuthProviderDialogProps) {
  const { t } = useTranslation()
  const isEditMode = !!provider

  const [formData, setFormData] = useState({
    name: '',
    providerType: 'oauth', // 'oauth' or 'ldap'
    clientId: '',
    clientSecret: '',
    authUrl: '',
    tokenUrl: '',
    userInfoUrl: '',
    scopes: 'openid,profile,email',
    issuer: '',
    enabled: true,
    // LDAP test fields
    testUsername: '',
    testPassword: '',
  })

  const [validationError, setValidationError] = useState('')
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; groups?: string[] } | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [showTestSection, setShowTestSection] = useState(false)

  const validateForm = () => {
    if (formData.providerType === 'oauth') {
      const hasIssuer = !!formData.issuer.trim()
      const hasUrls = !!(formData.authUrl.trim() && formData.tokenUrl.trim() && formData.userInfoUrl.trim())
      if (!hasIssuer && !hasUrls) {
        setValidationError(
          t(
            'oauthManagement.dialog.validation.issuerOrUrl',
            'Please fill in either Issuer or OAuth URL (Authorization, Token, User Info)'
          )
        )
        return false
      }
    } else if (formData.providerType === 'ldap') {
      // LDAP validation
      if (!formData.clientId.trim()) {
        setValidationError('LDAP Server URL is required')
        return false
      }
      if (!formData.authUrl.trim()) {
        setValidationError('Base DN is required')
        return false
      }
      if (!formData.tokenUrl.trim()) {
        setValidationError('User Filter is required')
        return false
      }
    }

    setValidationError('')
    return true
  }

  useEffect(() => {
    if (open) {
      if (provider) {
        // Determine provider type based on name (contains 'ldap' or not)
        const providerType = provider.name.toLowerCase().includes('ldap') ? 'ldap' : 'oauth'
        setFormData({
          name: provider.name || '',
          providerType: providerType,
          clientId: provider.clientId || '',
          clientSecret: '',
          authUrl: provider.authUrl || '',
          tokenUrl: provider.tokenUrl || '',
          userInfoUrl: provider.userInfoUrl || '',
          scopes: provider.scopes || 'openid,profile,email',
          issuer: provider.issuer || '',
          enabled: provider.enabled,
          testUsername: '',
          testPassword: '',
        })
      } else {
        setFormData({
          name: '',
          providerType: 'oauth',
          clientId: '',
          clientSecret: '',
          authUrl: '',
          tokenUrl: '',
          userInfoUrl: '',
          scopes: 'openid,profile,email',
          issuer: '',
          enabled: true,
          testUsername: '',
          testPassword: '',
        })
      }
      setTestResult(null)
      setShowTestSection(false)
    }
  }, [open, provider])

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

  const handleTestLDAP = async () => {
    if (!formData.clientId || !formData.authUrl || !formData.tokenUrl) {
      setValidationError('请填写LDAP服务器URL、基础DN和用户过滤器')
      return
    }

    setIsTesting(true)
    setTestResult(null)
    setValidationError('')

    try {
      const response = await fetch(withSubPath('/api/auth/ldap/test'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          serverUrl: formData.clientId,
          bindDn: formData.scopes,
          bindPassword: formData.clientSecret,
          baseDn: formData.authUrl,
          userFilter: formData.tokenUrl,
          groupFilter: formData.userInfoUrl,
          usernameAttr: formData.issuer || 'uid',
          testUsername: formData.testUsername,
          testPassword: formData.testPassword,
        }),
      })

      const result = await response.json()
      setTestResult(result)
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : '测试失败',
      })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-4xl max-h-[90vh] overflow-y-auto sm:!max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEditMode ? (
              <IconEdit className="h-5 w-5" />
            ) : (
              <IconKey className="h-5 w-5" />
            )}
            {isEditMode
              ? t('oauthManagement.dialog.editTitle', '编辑第三方认证')
              : t('oauthManagement.dialog.createTitle', '添加第三方认证')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Section 1: Name & Provider Type */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-medium">
                {t('oauthManagement.dialog.section.basic', 'Basic Information')}
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">
                  名称 (Name) *
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={handleInputChange('name')}
                  placeholder={formData.providerType === 'ldap' ? '例如：openldap, active_directory' : t(
                    'oauthManagement.dialog.namePlaceholder',
                    '例如：github, google'
                  )}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="providerType">
                  提供者类型 (Provider Type) *
                </Label>
                <Select
                  value={formData.providerType}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, providerType: value }))}
                >
                  <SelectTrigger id="providerType">
                    <SelectValue placeholder="选择提供者类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="oauth">OAuth</SelectItem>
                    <SelectItem value="ldap">LDAP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {formData.providerType === 'oauth' && (
              <div className="space-y-2">
                <Label htmlFor="scopes">
                  作用域 (Scopes)
                </Label>
                <Input
                  id="scopes"
                  value={formData.scopes}
                  onChange={handleInputChange('scopes')}
                  placeholder="openid,profile,email"
                />
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="client_id">
                  {formData.providerType === 'ldap' ? 'LDAP服务器地址 (Server URL) *' : '客户端ID (Client ID) *'}
                </Label>
                <Input
                  id="client_id"
                  value={formData.clientId}
                  onChange={handleInputChange('clientId')}
                  placeholder={formData.providerType === 'ldap' ? 'ldap://ldap.example.com:389' : 'OAuth Client ID'}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client_secret">
                  {formData.providerType === 'ldap' ? '绑定密码 (Bind Password)' : '客户端密钥 (Client Secret)'}
                  {isEditMode ? '' : ' *'}
                </Label>
                <Input
                  id="client_secret"
                  type="password"
                  value={formData.clientSecret}
                  onChange={handleInputChange('clientSecret')}
                  placeholder={
                    isEditMode
                      ? '留空以保持当前密钥'
                      : formData.providerType === 'ldap' ? '服务账号密码' : 'OAuth Client Secret'
                  }
                  required={!isEditMode}
                />
              </div>
            </div>
            
            {formData.providerType === 'ldap' && (
              <div className="space-y-2">
                <Label htmlFor="scopes">
                  绑定DN (Bind DN) ?
                </Label>
                <Input
                  id="scopes"
                  value={formData.scopes}
                  onChange={handleInputChange('scopes')}
                  placeholder="cn=admin,dc=example,dc=com"
                />
                <p className="text-xs text-muted-foreground">用于连接LDAP服务器的管理员账号DN</p>
              </div>
            )}
          </div>
          <Separator />
          
          {/* Section 2: URLs & Issuer */}
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="text-lg font-medium">
                {formData.providerType === 'ldap' ? 'LDAP配置 (LDAP Configuration)' : 'OAuth端点 (OAuth Endpoints)'}
              </h3>
            </div>
            
            {formData.providerType === 'oauth' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="issuer">
                    颁发者 (Issuer) ?
                  </Label>
                  <Input
                    id="issuer"
                    value={formData.issuer}
                    onChange={handleInputChange('issuer')}
                    placeholder="https://provider.com (自动发现)"
                  />
                  <p className="text-xs text-muted-foreground">OAuth提供商的Issuer URL，用于自动发现配置</p>
                </div>
                <div className="text-center text-sm text-muted-foreground py-2">
                  或 (or)
                </div>
              </>
            )}
            
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label htmlFor="authUrl">
                  {formData.providerType === 'ldap' ? '基础DN (Base DN) *' : '授权URL (Authorization URL) *'}
                </Label>
                <Input
                  id="authUrl"
                  value={formData.authUrl}
                  onChange={handleInputChange('authUrl')}
                  placeholder={formData.providerType === 'ldap' ? 'dc=example,dc=com' : 'https://provider.com/oauth/authorize'}
                  required={formData.providerType === 'ldap'}
                />
                {formData.providerType === 'ldap' && (
                  <p className="text-xs text-muted-foreground">LDAP搜索的基础DN，例如：dc=example,dc=com</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="tokenUrl">
                  {formData.providerType === 'ldap' ? '用户过滤器 (User Filter) *' : '令牌URL (Token URL) *'}
                </Label>
                <Input
                  id="tokenUrl"
                  value={formData.tokenUrl}
                  onChange={handleInputChange('tokenUrl')}
                  placeholder={formData.providerType === 'ldap' ? '(uid=%s)' : 'https://provider.com/oauth/token'}
                  required={formData.providerType === 'ldap'}
                />
                {formData.providerType === 'ldap' && (
                  <p className="text-xs text-muted-foreground">搜索用户的LDAP过滤器，%s会被替换为用户名，例如：(uid=%s)</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="userInfoUrl">
                  {formData.providerType === 'ldap' ? '组过滤器 (Group Filter) ?' : '用户信息URL (User Info URL)'}
                </Label>
                <Input
                  id="userInfoUrl"
                  value={formData.userInfoUrl}
                  onChange={handleInputChange('userInfoUrl')}
                  placeholder={formData.providerType === 'ldap' ? '(member=%s)' : 'https://provider.com/oauth/userinfo'}
                />
                {formData.providerType === 'ldap' && (
                  <p className="text-xs text-muted-foreground">搜索用户所属组的LDAP过滤器，%s会被替换为用户DN，例如：(member=%s)</p>
                )}
              </div>
              
              {formData.providerType === 'ldap' && (
                <div className="space-y-2">
                  <Label htmlFor="issuer">
                    用户名属性 (Username Attribute) ?
                  </Label>
                  <Input
                    id="issuer"
                    value={formData.issuer}
                    onChange={handleInputChange('issuer')}
                    placeholder="uid"
                  />
                  <p className="text-xs text-muted-foreground">LDAP中存储用户名的属性名，默认为uid</p>
                </div>
              )}
            </div>
          </div>
          
          {/* LDAP Test Section */}
          {formData.providerType === 'ldap' && (
            <>
              <Separator />
              <div className="space-y-4">
                <Collapsible open={showTestSection} onOpenChange={setShowTestSection}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium">连接测试 (Connection Test)</h3>
                    <CollapsibleTrigger asChild>
                      <Button type="button" variant="outline" size="sm">
                        {showTestSection ? '收起' : '展开'}
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent className="space-y-4 mt-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="testUsername">
                          测试用户名 (Test Username)
                        </Label>
                        <Input
                          id="testUsername"
                          value={formData.testUsername}
                          onChange={handleInputChange('testUsername')}
                          placeholder="testuser"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="testPassword">
                          测试密码 (Test Password)
                        </Label>
                        <Input
                          id="testPassword"
                          type="password"
                          value={formData.testPassword}
                          onChange={handleInputChange('testPassword')}
                          placeholder="testpassword"
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      onClick={handleTestLDAP}
                      disabled={isTesting}
                      className="w-full"
                    >
                      {isTesting ? (
                        <div className="flex items-center space-x-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2"></div>
                          <span>测试中...</span>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-2">
                          <IconTestPipe className="h-4 w-4" />
                          <span>测试连接 (Test Connection)</span>
                        </div>
                      )}
                    </Button>
                    {testResult && (
                      <Alert variant={testResult.success ? 'default' : 'destructive'}>
                        <AlertDescription>
                          <div className="space-y-2">
                            <div className={testResult.success ? 'text-green-600' : 'text-red-600'}>
                              {testResult.success ? '✓ 测试成功' : '✗ 测试失败'}
                            </div>
                            <div>{testResult.message}</div>
                            {testResult.groups && testResult.groups.length > 0 && (
                              <div className="text-sm">
                                <div className="font-medium">用户组 (Groups):</div>
                                <div className="text-muted-foreground">{testResult.groups.join(', ')}</div>
                              </div>
                            )}
                          </div>
                        </AlertDescription>
                      </Alert>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </>
          )}
          
          <Separator />
          {/* Section 3: Enable */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">
              状态 (Status)
            </h3>
            <div className="flex items-center space-x-2">
              <Switch
                id="enabled"
                checked={formData.enabled}
                onCheckedChange={handleSwitchChange('enabled')}
              />
              <Label htmlFor="enabled">
                启用 (Enabled)
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
              取消 (Cancel)
            </Button>
            <Button type="submit">
              {isEditMode ? '更新 (Update)' : '创建 (Create)'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
