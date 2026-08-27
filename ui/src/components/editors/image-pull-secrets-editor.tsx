import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { SecretSelector } from '@/components/selector/secret-selector'

const imagePullSecretTypes = [
  'kubernetes.io/dockerconfigjson',
  'kubernetes.io/dockercfg',
]

interface ImagePullSecretsEditorProps {
  namespace: string
  secrets: string[]
  onChange: (secrets: string[]) => void
}

export function ImagePullSecretsEditor({
  namespace,
  secrets,
  onChange,
}: ImagePullSecretsEditorProps) {
  const { t } = useTranslation()

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h4 className="text-base font-medium">
            {t('deployments.podConfiguration.imagePullSecrets')}
          </h4>
          <p className="text-xs text-muted-foreground">
            {t('deployments.podConfiguration.imagePullSecretsDescription')}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...secrets, ''])}
        >
          <Plus data-icon="inline-start" />
          {t('deployments.podConfiguration.addImagePullSecret')}
        </Button>
      </div>

      {secrets.map((secret, index) => (
        <div key={index} className="flex items-center gap-2">
          <SecretSelector
            className="flex-1"
            selectedSecret={secret}
            onSecretChange={(selectedSecret) =>
              onChange(
                secrets.map((currentSecret, secretIndex) =>
                  secretIndex === index ? selectedSecret : currentSecret
                )
              )
            }
            namespace={namespace}
            placeholder={t(
              'deployments.podConfiguration.selectImagePullSecret'
            )}
            allowedTypes={imagePullSecretTypes}
            excludedSecrets={secrets.filter(
              (_, secretIndex) => secretIndex !== index
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t(
              'deployments.podConfiguration.removeImagePullSecret',
              { index: index + 1 }
            )}
            onClick={() =>
              onChange(
                secrets.filter((_, secretIndex) => secretIndex !== index)
              )
            }
          >
            <Trash2 />
          </Button>
        </div>
      ))}
    </section>
  )
}
