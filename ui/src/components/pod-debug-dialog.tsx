import { useState } from 'react'
import { Container, Pod } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'

import { copyDebugPod, debugPod } from '@/lib/api'
import { translateError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export function PodDebugDialog({
  namespace,
  name,
  containers,
  ephemeralAvailable,
  onClose,
  onCreated,
}: {
  namespace: string
  name: string
  containers: Container[]
  ephemeralAvailable: boolean
  onClose: () => void
  onCreated: (pod: Pod, containerName: string) => void
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState(ephemeralAvailable ? 'ephemeral' : 'copy')
  const [image, setImage] = useState('busybox:1.37')
  const [copyImage, setCopyImage] = useState('')
  const [copyTo, setCopyTo] = useState(`${name}-debug`)
  const [program, setProgram] = useState('sh')
  const [argumentsText, setArgumentsText] = useState('')
  const [targetContainerName, setTargetContainerName] = useState(
    containers[0]?.name || ''
  )
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')
  const isCopy = mode === 'copy'
  const targetImage = containers.find(
    (container) => container.name === targetContainerName
  )?.image
  const trimmedProgram = program.trim()
  const command = trimmedProgram
    ? [
        trimmedProgram,
        ...argumentsText.split('\n').filter((arg) => arg.length > 0),
      ]
    : []

  const handleCreate = async () => {
    setIsCreating(true)
    setError('')
    try {
      const result = isCopy
        ? await copyDebugPod(namespace, name, {
            copyTo: copyTo.trim(),
            targetContainerName,
            image: copyImage.trim() || undefined,
            command,
          })
        : await debugPod(namespace, name, {
            image: image.trim(),
            targetContainerName,
            command: command.length > 0 ? command : undefined,
          })
      onCreated(result.pod, result.containerName)
    } catch (error) {
      setError(translateError(error, t))
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !isCreating && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="text-balance">
            {t('pods.debugTitle')}
          </DialogTitle>
          <DialogDescription className="text-pretty">
            {t(isCopy ? 'pods.debugCopyDescription' : 'pods.debugDescription', {
              name,
            })}
            <span className="mt-2 block">
              {t(isCopy ? 'pods.debugCopyNote' : 'pods.debugLifecycleNote')}
            </span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pod-debug-mode">{t('pods.debugMode')}</Label>
            <Select
              value={mode}
              onValueChange={(value) => {
                setMode(value)
                setError('')
              }}
              disabled={isCreating}
            >
              <SelectTrigger id="pod-debug-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ephemeral" disabled={!ephemeralAvailable}>
                  {t('pods.debugModeEphemeral')}
                </SelectItem>
                <SelectItem value="copy">{t('pods.debugModeCopy')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isCopy && (
            <div className="space-y-2">
              <Label htmlFor="pod-debug-copy-name">
                {t('pods.debugCopyName')}
              </Label>
              <Input
                id="pod-debug-copy-name"
                value={copyTo}
                onChange={(event) => setCopyTo(event.target.value)}
                disabled={isCreating}
                autoComplete="off"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="pod-debug-target">{t('pods.debugTarget')}</Label>
            <Select
              value={targetContainerName}
              onValueChange={setTargetContainerName}
              disabled={isCreating}
            >
              <SelectTrigger id="pod-debug-target" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {containers.map((container) => (
                  <SelectItem key={container.name} value={container.name}>
                    {container.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pod-debug-image">{t('pods.debugImage')}</Label>
            <Input
              id="pod-debug-image"
              value={isCopy ? copyImage : image}
              onChange={(event) =>
                isCopy
                  ? setCopyImage(event.target.value)
                  : setImage(event.target.value)
              }
              placeholder={isCopy ? targetImage : undefined}
              disabled={isCreating}
              aria-describedby="pod-debug-image-hint"
              autoComplete="off"
            />
            <p
              id="pod-debug-image-hint"
              className="text-pretty text-sm text-muted-foreground"
            >
              {t(isCopy ? 'pods.debugCopyImageHint' : 'pods.debugImageHint')}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pod-debug-program">{t('pods.debugProgram')}</Label>
            <Input
              id="pod-debug-program"
              value={program}
              onChange={(event) => setProgram(event.target.value)}
              disabled={isCreating}
              aria-describedby="pod-debug-program-hint"
              autoComplete="off"
            />
            <p
              id="pod-debug-program-hint"
              className="text-pretty text-sm text-muted-foreground"
            >
              {t(
                isCopy
                  ? 'pods.debugProgramHint'
                  : 'pods.debugProgramEphemeralHint'
              )}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pod-debug-arguments">
              {t('pods.debugArguments')}
            </Label>
            <Textarea
              id="pod-debug-arguments"
              value={argumentsText}
              onChange={(event) => setArgumentsText(event.target.value)}
              disabled={isCreating || !trimmedProgram}
              aria-describedby="pod-debug-arguments-hint"
              rows={2}
            />
            <p
              id="pod-debug-arguments-hint"
              className="text-pretty text-sm text-muted-foreground"
            >
              {t('pods.debugArgumentsHint')}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-pretty text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isCreating}>
            {t('common.actions.cancel')}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={
              isCreating ||
              !targetContainerName ||
              (isCopy
                ? !copyTo.trim() || !trimmedProgram
                : !ephemeralAvailable || !image.trim())
            }
          >
            {isCreating ? t('pods.debugCreating') : t('pods.debugCreate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
