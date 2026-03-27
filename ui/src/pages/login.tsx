import { FormEvent, useEffect, useState } from 'react'
import Logo from '@/assets/icon.svg'
import { useAuth } from '@/contexts/auth-context'
import { useTranslation } from 'react-i18next'
import { Navigate, useSearchParams } from 'react-router-dom'

import type { CredentialProvider } from '@/lib/api'
import { withSubPath } from '@/lib/subpath'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Footer } from '@/components/footer'
import { LanguageToggle } from '@/components/language-toggle'

export function LoginPage() {
  const { t } = useTranslation()
  const {
    user,
    login,
    loginWithCredentials,
    credentialProviders,
    oauthProviders,
    isLoading,
  } = useAuth()
  const [searchParams] = useSearchParams()
  const [loginLoading, setLoginLoading] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [credentialError, setCredentialError] = useState<string | null>(null)
  const [credentialsProvider, setCredentialsProvider] =
    useState<CredentialProvider>('password')

  const error = searchParams.get('error')
  const totalProviders = credentialProviders.length + oauthProviders.length

  useEffect(() => {
    if (
      credentialProviders.length > 0 &&
      !credentialProviders.includes(credentialsProvider)
    ) {
      setCredentialsProvider(credentialProviders[0])
    }
  }, [credentialProviders, credentialsProvider])

  if (user && !isLoading) {
    return <Navigate to="/" replace />
  }

  const handleLogin = async (provider: string) => {
    setLoginLoading(provider)
    try {
      await login(provider)
    } catch (error) {
      console.error('Login error:', error)
      setLoginLoading(null)
    }
  }

  const handleCredentialLogin = async (e: FormEvent) => {
    e.preventDefault()
    setLoginLoading(credentialsProvider)
    setCredentialError(null)
    try {
      await loginWithCredentials(credentialsProvider, username, password)
    } catch (err) {
      if (err instanceof Error) {
        setCredentialError(
          t(`login.errors.${err.message}`, {
            defaultValue: err.message,
          }) || t('login.errors.invalidCredentials')
        )
      } else {
        setCredentialError(t('login.errors.unknownError'))
      }
    } finally {
      setLoginLoading(null)
    }
  }

  const credentialTabLabel = {
    password: t('login.tabs.password', 'Password'),
    ldap: t('login.tabs.ldap', 'LDAP'),
  } satisfies Record<CredentialProvider, string>

  const credentialSubmitLabel = {
    password: t('login.signInWithPassword', 'Sign In with Password'),
    ldap: t('login.signInWithLdap', 'Sign In with LDAP'),
  } satisfies Record<CredentialProvider, string>

  const getErrorMessage = (errorCode: string | null) => {
    if (!errorCode) return null

    // Get additional parameters for more detailed error messages
    const provider = searchParams.get('provider') || 'OAuth provider'
    const user = searchParams.get('user')
    const reason = searchParams.get('reason') || errorCode

    switch (reason) {
      case 'insufficient_permissions':
        return {
          title: t('login.errors.accessDenied'),
          message: user
            ? t('login.errors.insufficientPermissionsUser', { user })
            : t('login.errors.insufficientPermissions'),
          details: t('login.errors.insufficientPermissionsDetails'),
        }
      case 'token_exchange_failed':
        return {
          title: t('login.errors.authenticationFailed'),
          message: t('login.errors.tokenExchangeFailed', { provider }),
          details: t('login.errors.tokenExchangeDetails'),
        }
      case 'user_info_failed':
        return {
          title: t('login.errors.profileAccessFailed'),
          message: t('login.errors.userInfoFailed', { provider }),
          details: t('login.errors.userInfoDetails'),
        }
      case 'jwt_generation_failed':
        return {
          title: t('login.errors.sessionCreationFailed'),
          message: user
            ? t('login.errors.jwtGenerationFailedUser', { user })
            : t('login.errors.jwtGenerationFailed'),
          details: t('login.errors.jwtGenerationDetails'),
        }
      case 'callback_failed':
        return {
          title: t('login.errors.oauthCallbackFailed'),
          message: t('login.errors.callbackFailed'),
          details: t('login.errors.contactSupport'),
        }
      case 'callback_error':
        return {
          title: t('login.errors.authenticationError'),
          message: t('login.errors.callbackError'),
          details: t('login.errors.contactSupport'),
        }
      case 'user_disabled':
        return {
          title: t('login.errors.userDisabled', 'User Disabled'),
          message: t('login.errors.userDisabledMessage'),
        }
      case 'not_in_allowed_groups':
        return {
          title: t('login.errors.accessDenied'),
          message: t('login.errors.notInAllowedGroups', { provider }),
          details: t('login.errors.notInAllowedGroupsDetails'),
        }
      default:
        return {
          title: t('login.errors.authenticationError'),
          message: t('login.errors.generalError'),
          details: t('login.errors.contactSupport'),
        }
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Language Toggle - Top Right */}
      <div className="absolute top-6 right-6 z-10">
        <LanguageToggle />
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center space-x-2 mb-4">
              <img src={Logo} className="h-10 w-10 dark:invert" />{' '}
              <h1 className="text-2xl font-bold">Kite</h1>
            </div>
            <p className="text-gray-600">{t('login.kubernetesDashboard')}</p>
          </div>

          <Card className="shadow-sm border">
            <CardHeader className="text-center">
              <CardTitle className="text-xl">{t('login.signIn')}</CardTitle>
              <CardDescription className="text-gray-600">
                {t('login.subtitle')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="space-y-3">
                  <Alert className="border-red-200 bg-red-50">
                    <AlertDescription className="text-red-700">
                      <div className="space-y-2">
                        <div className="font-semibold">
                          {getErrorMessage(error)?.title}
                        </div>
                        <div>{getErrorMessage(error)?.message}</div>
                        {getErrorMessage(error)?.details && (
                          <div className="text-sm text-red-600 mt-2">
                            {getErrorMessage(error)?.details}
                          </div>
                        )}
                      </div>
                    </AlertDescription>
                  </Alert>

                  {/* Additional actions for permission errors */}
                  {(searchParams.get('reason') === 'insufficient_permissions' ||
                    error === 'insufficient_permissions') && (
                    <div className="text-center space-y-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          window.location.href = withSubPath('/login')
                        }}
                        className="w-full"
                      >
                        {t('login.tryAgainDifferentAccount')}
                      </Button>
                      <p className="text-xs text-gray-500">
                        {t('login.tryAgainHint')}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {totalProviders === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-600">{t('login.noLoginMethods')}</p>
                  <p className="text-sm text-gray-500 mt-2">
                    {t('login.configureAuth')}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {credentialProviders.length > 0 && (
                    <div className="space-y-4">
                      {credentialProviders.length > 1 && (
                        <Tabs
                          value={credentialsProvider}
                          onValueChange={(value) => {
                            if (value === 'password' || value === 'ldap') {
                              setCredentialsProvider(value)
                              setCredentialError(null)
                            }
                          }}
                        >
                          <TabsList
                            className={`grid w-full ${
                              credentialProviders.length > 1
                                ? 'grid-cols-2'
                                : 'grid-cols-1'
                            }`}
                          >
                            {credentialProviders.map((provider) => (
                              <TabsTrigger key={provider} value={provider}>
                                {credentialTabLabel[provider]}
                              </TabsTrigger>
                            ))}
                          </TabsList>
                        </Tabs>
                      )}

                      <form
                        onSubmit={handleCredentialLogin}
                        className="space-y-4"
                      >
                        <div className="space-y-2">
                          <Label htmlFor="username">
                            {t('login.username')}
                          </Label>
                          <Input
                            id="username"
                            type="text"
                            placeholder={t('login.enterUsername')}
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="password">
                            {t('login.password')}
                          </Label>
                          <Input
                            id="password"
                            type="password"
                            placeholder={t('login.enterPassword')}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                          />
                        </div>
                        {credentialError && (
                          <Alert variant="destructive">
                            <AlertDescription>
                              {credentialError}
                            </AlertDescription>
                          </Alert>
                        )}
                        <Button
                          type="submit"
                          disabled={loginLoading !== null}
                          className="w-full"
                        >
                          {loginLoading === credentialsProvider ? (
                            <div className="flex items-center space-x-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2"></div>
                              <span>{t('login.signingIn')}</span>
                            </div>
                          ) : (
                            credentialSubmitLabel[credentialsProvider]
                          )}
                        </Button>
                      </form>
                    </div>
                  )}

                  {oauthProviders.length > 0 &&
                    credentialProviders.length > 0 && (
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="px-2 text-muted-foreground bg-card rounded">
                            {t('login.orContinueWith')}
                          </span>
                        </div>
                      </div>
                    )}

                  {oauthProviders.map((provider) => (
                    <Button
                      key={provider}
                      onClick={() => handleLogin(provider)}
                      disabled={loginLoading !== null}
                      className="w-full h-10"
                      variant="outline"
                    >
                      {loginLoading === provider ? (
                        <div className="flex items-center space-x-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2"></div>
                          <span>{t('login.signingIn')}</span>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-2">
                          <span>
                            {t('login.signInWith', {
                              provider:
                                provider.charAt(0).toUpperCase() +
                                provider.slice(1),
                            })}
                          </span>
                        </div>
                      )}
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer */}
      <Footer />
    </div>
  )
}
