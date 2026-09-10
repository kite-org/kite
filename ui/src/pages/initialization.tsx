import { useState } from 'react'
import Logo from '@/assets/icon.svg'
import { useAuth } from '@/contexts/auth-context'
import {
  IconArrowRight,
  IconArrowUpRight,
  IconCheck,
  IconChevronDown,
  IconEye,
  IconEyeOff,
  IconLoader,
  IconWorld,
} from '@tabler/icons-react'
import { Trans, useTranslation } from 'react-i18next'
import { Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { createSuperUser, importClusters, useInitCheck } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

export function InitializationPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { data: initCheck, isLoading, refetch } = useInitCheck()
  const { checkAuth, user, isLoading: isAuthLoading } = useAuth()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // User form state
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')
  const [enableAnalytics, setEnableAnalytics] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

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

  if (step > 0 && isAuthLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (step > 0 && !user) {
    return <Navigate to="/login" replace />
  }

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
        enableAnalytics,
      })
      toast.success(t('initialization.step1.createSuccess'))
      try {
        await checkAuth()
      } catch {
        await refetch()
        navigate('/login', { replace: true })
        return
      }
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
    <div className="min-h-dvh bg-background text-foreground [--primary:#6366f1] [--primary-foreground:#fff] [--ring:#6366f1] [font-family:var(--font-sans)] lg:grid lg:grid-cols-[20rem_1fr] xl:grid-cols-[24rem_1fr]">
      <aside className="flex flex-col border-b bg-[#f7f8fc] px-6 py-6 dark:bg-muted/30 sm:px-8 lg:min-h-dvh lg:border-r lg:border-b-0 lg:py-8 xl:px-10">
        <div className="flex items-center gap-3">
          <img src={Logo} alt="" className="size-9" />
          <span className="font-mono text-2xl font-semibold tracking-tight">
            Kite
          </span>
        </div>

        <div className="mt-8 lg:mt-16">
          <h1 className="text-2xl font-semibold tracking-tight lg:text-[1.75rem]">
            {t('initialization.welcome')}
          </h1>
          <p className="mt-3 whitespace-pre-line text-base leading-6 text-muted-foreground">
            {t('initialization.subtitle')}
          </p>
        </div>

        <ol className="mt-6 flex gap-4 lg:mt-10 lg:block lg:space-y-8">
          {[1, 2].map((number) => (
            <li
              key={number}
              aria-current={actualCurrentStep === number ? 'step' : undefined}
              className="relative flex flex-1 items-start gap-3"
            >
              {number === 1 && (
                <span
                  className="absolute top-11 -bottom-6 left-4.5 hidden border-l border-input lg:block"
                  aria-hidden="true"
                />
              )}
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-full border text-sm font-medium',
                  actualCurrentStep >= number
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background text-muted-foreground'
                )}
              >
                {actualCurrentStep > number ? (
                  <IconCheck className="size-4" aria-hidden="true" />
                ) : (
                  number
                )}
              </span>
              <div className="pt-0.5">
                <p className="text-sm font-medium leading-5 lg:text-base">
                  {t(`initialization.step${number}.title`)}
                </p>
                <p className="mt-1 hidden text-sm leading-5 text-muted-foreground lg:block">
                  {t(`initialization.step${number}.description`)}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-auto hidden items-center gap-6 pt-12 text-sm text-muted-foreground lg:flex">
          <a
            href="https://kite.zzde.me"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 hover:text-foreground"
          >
            {t('initialization.documentation')}
            <IconArrowUpRight className="size-4" aria-hidden="true" />
          </a>
          <a
            href="https://github.com/zxh326/kite"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 hover:text-foreground"
          >
            GitHub
            <IconArrowUpRight className="size-4" aria-hidden="true" />
          </a>
        </div>
      </aside>

      <main className="relative min-w-0 px-6 py-8 sm:px-10 lg:flex lg:items-center lg:px-16 lg:py-16">
        <div className="absolute top-5 right-6 lg:fixed lg:top-5 lg:right-8">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="gap-2 text-sm font-normal"
                aria-label={t('common.fields.language')}
              >
                <IconWorld className="size-4 text-muted-foreground" />
                {i18n.language.startsWith('zh') ? '中文' : 'English'}
                <IconChevronDown className="size-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => i18n.changeLanguage('en')}>
                English
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => i18n.changeLanguage('zh')}>
                中文
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mx-auto w-full max-w-[38rem] pt-12 lg:pt-0">
          <header className="mb-6">
            <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              {t('initialization.stepCounter', {
                current: actualCurrentStep,
                total: 2,
              })}
            </p>
            <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              {t(`initialization.step${actualCurrentStep}.heading`)}
            </h2>
            <p className="mt-2 text-base leading-6 text-muted-foreground">
              {t(`initialization.step${actualCurrentStep}.headingDescription`)}
            </p>
          </header>

          {error && (
            <Alert variant="destructive" className="mb-6" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {actualCurrentStep === 1 ? (
            <>
              <form onSubmit={handleCreateUser} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-sm">
                    {t('initialization.step1.usernameRequired')}
                  </Label>
                  <Input
                    id="username"
                    autoComplete="username"
                    placeholder={t('initialization.step1.usernamePlaceholder')}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="h-11 shadow-none md:text-base"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-sm">
                    {t('initialization.step1.displayName')}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">
                      {t('initialization.step1.optional')}
                    </span>
                  </Label>
                  <Input
                    id="name"
                    autoComplete="name"
                    placeholder={t(
                      'initialization.step1.displayNamePlaceholder'
                    )}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-11 shadow-none md:text-base"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm">
                    {t('initialization.step1.passwordRequired')}
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder={t(
                        'initialization.step1.passwordPlaceholder'
                      )}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-11 pr-11 shadow-none md:text-base"
                      required
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t(
                        showPassword
                          ? 'initialization.step1.hidePassword'
                          : 'initialization.step1.showPassword'
                      )}
                      aria-controls="password"
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
                    >
                      {showPassword ? (
                        <IconEyeOff className="size-4" />
                      ) : (
                        <IconEye className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-sm">
                    {t('initialization.step1.confirmPasswordRequired')}
                  </Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder={t(
                        'initialization.step1.confirmPasswordPlaceholder'
                      )}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="h-11 pr-11 shadow-none md:text-base"
                      required
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t(
                        showConfirmPassword
                          ? 'initialization.step1.hidePassword'
                          : 'initialization.step1.showPassword'
                      )}
                      aria-controls="confirmPassword"
                      aria-pressed={showConfirmPassword}
                      onClick={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
                      className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
                    >
                      {showConfirmPassword ? (
                        <IconEyeOff className="size-4" />
                      ) : (
                        <IconEye className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 border-t pt-4">
                  <Label htmlFor="setup-enable-analytics" className="text-sm">
                    {t('generalManagement.runtime.form.enableAnalytics')}
                  </Label>
                  <Switch
                    id="setup-enable-analytics"
                    checked={enableAnalytics}
                    onCheckedChange={setEnableAnalytics}
                    disabled={isSubmitting}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-11 w-full gap-2 text-base shadow-none"
                >
                  {isSubmitting ? (
                    <IconLoader className="size-5 animate-spin" />
                  ) : null}
                  {t(
                    isSubmitting
                      ? 'initialization.step1.creating'
                      : 'initialization.step1.createButton'
                  )}
                  {!isSubmitting && <IconArrowRight className="size-4" />}
                </Button>
              </form>
              <p className="mt-3 text-sm text-muted-foreground">
                {t('initialization.step1.nextStep')}
              </p>
              <div className="mt-5 space-y-1.5 border-t pt-4">
                <p className="text-sm font-medium">
                  {t('initialization.anonymousTitle')}
                </p>
                <p className="text-sm leading-5 text-muted-foreground">
                  <Trans
                    i18nKey="initialization.anonymousDescription"
                    components={{
                      code: (
                        <code className="rounded bg-muted px-2 py-0.5 text-xs" />
                      ),
                    }}
                  />
                </p>
              </div>
            </>
          ) : (
            <form onSubmit={handleImportClusters} className="space-y-5">
              <Tabs
                value={
                  isInCluster ? 'in-cluster' : isFileMode ? 'file' : 'paste'
                }
                onValueChange={(value) => {
                  setIsInCluster(value === 'in-cluster')
                  setIsFileMode(value === 'file')
                }}
              >
                <TabsList className="h-10 w-full">
                  <TabsTrigger value="paste">
                    {t('initialization.step2.pasteMode')}
                  </TabsTrigger>
                  <TabsTrigger value="file">
                    {t('initialization.step2.fileMode')}
                  </TabsTrigger>
                  <TabsTrigger value="in-cluster">
                    {t('clusterManagement.type.inCluster')}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="in-cluster" className="mt-5">
                  <p className="rounded-lg border p-5 text-sm leading-relaxed text-muted-foreground">
                    {t('common.messages.inClusterConfiguration')}
                  </p>
                </TabsContent>
                <TabsContent value="file" className="mt-5 space-y-3">
                  <Label htmlFor="kubeconfig-file" className="text-sm">
                    {t('initialization.step2.kubeconfigRequired')}
                  </Label>
                  <Input
                    id="kubeconfig-file"
                    type="file"
                    onChange={handleFileSelect}
                    className="h-auto cursor-pointer px-4 py-3 shadow-none"
                  />
                  <p className="text-sm text-muted-foreground">
                    {t('initialization.step2.fileHint')}
                  </p>
                </TabsContent>
                <TabsContent value="paste" className="mt-5 space-y-3">
                  <Label htmlFor="kubeconfig" className="text-sm">
                    {t('initialization.step2.kubeconfigRequired')}
                  </Label>
                  <Textarea
                    id="kubeconfig"
                    placeholder={t(
                      'initialization.step2.kubeconfigPlaceholder'
                    )}
                    value={kubeconfig}
                    onChange={(e) => setKubeconfig(e.target.value)}
                    rows={10}
                    className="min-h-64 p-4 font-mono text-sm shadow-none"
                  />
                </TabsContent>
                {!isInCluster && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {t('initialization.step2.kubeconfigHint')}
                  </p>
                )}
              </Tabs>
              <Button
                type="submit"
                disabled={isSubmitting || (!isInCluster && !kubeconfig.trim())}
                className="h-11 w-full gap-2 text-base shadow-none"
              >
                {isSubmitting ? (
                  <IconLoader className="size-5 animate-spin" />
                ) : null}
                {t(
                  isSubmitting
                    ? 'initialization.step2.importing'
                    : 'initialization.step2.importButton'
                )}
                {!isSubmitting && <IconArrowRight className="size-4" />}
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}
