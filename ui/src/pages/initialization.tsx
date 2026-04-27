import { useState } from 'react'
import Logo from '@/assets/icon.svg'
import {
  IconCheck,
  IconLoader,
  IconServer,
  IconUser,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'
import { toast } from 'sonner'

import { createSuperUser, importClusters, useInitCheck } from '@/lib/api'
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
import { Textarea } from '@/components/ui/textarea'
import { Footer } from '@/components/footer'
import { LanguageToggle } from '@/components/language-toggle'

interface InitStepProps {
  step: number
  currentStep: number
  title: string
  description: string
  icon: React.ElementType
  completed: boolean
  children: React.ReactNode
}

function InitStep({
  step,
  currentStep,
  title,
  description,
  icon: Icon,
  completed,
  children,
}: InitStepProps) {
  const isActive = step === currentStep
  const isPending = step > currentStep

  return (
    <div className={`space-y-4 ${isPending ? 'opacity-50' : ''}`}>
      <div className="flex items-center space-x-3">
        <div
          className={`flex aspect-square h-10 w-10 items-center justify-center rounded-full border-2 flex-shrink-0 ${
            completed
              ? 'border-green-500 bg-green-500 text-white'
              : isActive
                ? 'border-blue-500 bg-blue-50 text-blue-600'
                : 'border-gray-300 bg-gray-50 text-gray-400'
          }`}
        >
          {completed ? (
            <IconCheck className="h-5 w-5" />
          ) : (
            <Icon className="h-5 w-5" />
          )}
        </div>
        <div>
          <h3
            className={`text-lg font-medium ${
              completed
                ? 'text-green-600'
                : isActive
                  ? 'text-gray-900'
                  : 'text-gray-400'
            }`}
          >
            {title}
          </h3>
          <p
            className={`text-xs text-muted-foreground ${
              completed
                ? 'text-green-600'
                : isActive
                  ? 'text-gray-600'
                  : 'text-gray-400'
            }`}
          >
            {description}
          </p>
        </div>
      </div>
      {isActive && <div className="ml-13">{children}</div>}
    </div>
  )
}

export function InitializationPage() {
  const { t } = useTranslation()
  const { data: initCheck, isLoading, refetch } = useInitCheck()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // User form state
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')

  // Cluster form state
  const [kubeconfig, setKubeconfig] = useState('')
  const [isFileMode, setIsFileMode] = useState(false)
  const [isInCluster, setIsInCluster] = useState(false)

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        setKubeconfig(content)
      }
      reader.readAsText(file)
    }
  }

  // If loading, show spinner
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    )
  }

  // If already initialized, redirect to home
  if (initCheck?.initialized) {
    return <Navigate to="/" replace />
  }

  const step = initCheck?.step || 0
  const actualCurrentStep = Math.max(1, step + 1)

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError(t('initialization.step1.passwordMismatch'))
      return
    }

    setIsSubmitting(true)
    try {
      await createSuperUser({
        username,
        password,
        name: name || undefined,
      })
      toast.success(t('initialization.step1.createSuccess'))
      await refetch()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('initialization.step1.createError')
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleImportClusters = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!isInCluster && !kubeconfig.trim()) {
      setError(t('initialization.step2.configRequired'))
      return
    }

    setIsSubmitting(true)
    try {
      await importClusters({ config: kubeconfig, inCluster: isInCluster })
      toast.success(t('initialization.step2.importSuccess'))
      await refetch()
      // Will redirect to home page when initialized becomes true
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('initialization.step2.importError')
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="absolute top-6 right-6 z-10">
        <LanguageToggle />
      </div>

      <div className="flex-1 flex items-center justify-center py-8 px-4">
        <div className="w-full max-w-2xl">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center space-x-2 mb-4">
              <img src={Logo} className="h-10 w-10" />{' '}
              <h1 className="text-2xl font-bold">Kite</h1>
            </div>
          </div>

          <Card>
            <CardHeader className="text-center pb-6">
              <CardTitle className="text-xl">
                {t('initialization.title')}
              </CardTitle>
              <CardDescription>
                {t('initialization.description')}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Step 1: Create Super Admin User */}
              <InitStep
                step={1}
                currentStep={actualCurrentStep}
                title={t('initialization.step1.title')}
                description={t('initialization.step1.description')}
                icon={IconUser}
                completed={step >= 1}
              >
                <form onSubmit={handleCreateUser} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">
                      {t('initialization.step1.usernameRequired')}
                    </Label>
                    <Input
                      id="username"
                      type="text"
                      placeholder={t(
                        'initialization.step1.usernamePlaceholder'
                      )}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name">
                      {t('initialization.step1.displayName')}
                    </Label>
                    <Input
                      id="name"
                      type="text"
                      placeholder={t(
                        'initialization.step1.displayNamePlaceholder'
                      )}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">
                      {t('initialization.step1.passwordRequired')}
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder={t(
                        'initialization.step1.passwordPlaceholder'
                      )}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">
                      {t('initialization.step1.confirmPasswordRequired')}
                    </Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder={t(
                        'initialization.step1.confirmPasswordPlaceholder'
                      )}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full"
                  >
                    {isSubmitting ? (
                      <div className="flex items-center space-x-2">
                        <IconLoader className="h-4 w-4 animate-spin" />
                        <span>{t('initialization.step1.creating')}</span>
                      </div>
                    ) : (
                      t('initialization.step1.createButton')
                    )}
                  </Button>
                </form>
              </InitStep>

              {/* Step 2: Import Cluster */}
              <InitStep
                step={2}
                currentStep={actualCurrentStep}
                title={t('initialization.step2.title')}
                description={t('initialization.step2.description')}
                icon={IconServer}
                completed={step >= 2}
              >
                <form onSubmit={handleImportClusters} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="kubeconfig">
                      {t('initialization.step2.kubeconfigRequired')}
                    </Label>

                    <div className="flex items-center space-x-4 mb-3">
                      <button
                        type="button"
                        onClick={() => {
                          setIsInCluster(false)
                          setIsFileMode(false)
                        }}
                        className={`px-3 py-1 text-sm rounded-md transition-colors ${
                          !isFileMode && !isInCluster
                            ? 'bg-blue-100 text-blue-700 border border-blue-300'
                            : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200'
                        }`}
                      >
                        {t('initialization.step2.pasteMode', {
                          defaultValue: 'Paste Content',
                        })}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsInCluster(false)
                          setIsFileMode(true)
                        }}
                        className={`px-3 py-1 text-sm rounded-md transition-colors ${
                          isFileMode && !isInCluster
                            ? 'bg-blue-100 text-blue-700 border border-blue-300'
                            : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200'
                        }`}
                      >
                        {t('initialization.step2.fileMode', {
                          defaultValue: 'Upload File',
                        })}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsInCluster(true)
                          setIsFileMode(false)
                        }}
                        className={`px-3 py-1 text-sm rounded-md transition-colors ${
                          isInCluster
                            ? 'bg-blue-100 text-blue-700 border border-blue-300'
                            : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200'
                        }`}
                      >
                        {t('clusterManagement.type.inCluster', {
                          defaultValue: 'In-Cluster',
                        })}
                      </button>
                    </div>

                    {isInCluster ? (
                      <div className="space-y-2">
                        <p className="text-sm text-gray-600">
                          {t('common.messages.inClusterConfiguration', {
                            defaultValue:
                              'Import clusters from inside the running Kite instance. No kubeconfig required.',
                          })}
                        </p>
                      </div>
                    ) : isFileMode ? (
                      <div className="space-y-2">
                        <input
                          type="file"
                          onChange={handleFileSelect}
                          className="w-full text-sm text-gray-500
                            file:mr-4 file:py-2 file:px-4
                            file:rounded-md file:border-0
                            file:text-sm file:font-medium
                            file:bg-blue-50 file:text-blue-700
                            hover:file:bg-blue-100
                            file:cursor-pointer cursor-pointer"
                        />
                        <p className="text-xs text-gray-500">
                          {t('initialization.step2.fileHint', {
                            defaultValue:
                              'Select your kubeconfig file (usually located at ~/.kube/config)',
                          })}
                        </p>
                      </div>
                    ) : (
                      <Textarea
                        id="kubeconfig"
                        placeholder={t(
                          'initialization.step2.kubeconfigPlaceholder'
                        )}
                        value={kubeconfig}
                        onChange={(e) => setKubeconfig(e.target.value)}
                        rows={8}
                        className="text-sm"
                      />
                    )}

                    <p className="text-xs text-gray-500">
                      {t('initialization.step2.kubeconfigHint')}
                    </p>
                  </div>
                  <Button
                    type="submit"
                    disabled={
                      isSubmitting || (!isInCluster && !kubeconfig.trim())
                    }
                    className="w-full"
                  >
                    {isSubmitting ? (
                      <div className="flex items-center space-x-2">
                        <IconLoader className="h-4 w-4 animate-spin" />
                        <span>{t('initialization.step2.importing')}</span>
                      </div>
                    ) : (
                      t('initialization.step2.importButton')
                    )}
                  </Button>
                </form>
              </InitStep>

              {/* Completion message */}
              {step >= 2 && (
                <div className="text-center py-6">
                  <div className="flex items-center justify-center mb-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                      <IconCheck className="h-6 w-6 text-green-600" />
                    </div>
                  </div>
                  <h3 className="text-lg font-medium text-green-600">
                    {t('initialization.completion.title')}
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {t('initialization.completion.message')}
                  </p>
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
