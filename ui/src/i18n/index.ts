import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { locale, onLocaleChange } from 'mygo-runtime'
import { initReactI18next } from 'react-i18next'

import { isDesktop } from '@/lib/desktop'
import { DesktopService } from '@/lib/mygo'

import en from './locales/en.json'
import zh from './locales/zh.json'

const desktopLanguage = (language: string) =>
  language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
const nativeLanguage = isDesktop ? desktopLanguage(locale()) : undefined
const savedLanguage = isDesktop ? localStorage.getItem('i18nextLng') : null
const initialLanguage = savedLanguage
  ? desktopLanguage(savedLanguage)
  : nativeLanguage

const resources = {
  en: {
    translation: en,
  },
  zh: {
    translation: zh,
  },
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    ...(initialLanguage && { lng: initialLanguage }),
    fallbackLng: 'en',
    debug: false,

    interpolation: {
      escapeValue: false,
    },

    detection: {
      order: ['localStorage'],
      caches: ['localStorage'],
    },
  })

if (isDesktop) {
  onLocaleChange((language) => {
    const nextLanguage = desktopLanguage(language)
    if (i18n.language !== nextLanguage) void i18n.changeLanguage(nextLanguage)
  })
  i18n.on('languageChanged', (language) => {
    const nextLanguage = desktopLanguage(language)
    if (nextLanguage !== desktopLanguage(locale())) {
      void DesktopService.setLanguage(nextLanguage)
    }
  })
  if (initialLanguage && initialLanguage !== nativeLanguage) {
    void DesktopService.setLanguage(initialLanguage)
  }
}

export default i18n
