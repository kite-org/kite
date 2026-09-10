import * as React from 'react'
import * as JSXDevRuntime from 'react/jsx-dev-runtime'
import * as JSXRuntime from 'react/jsx-runtime'
import * as SDK from '@kite-dev/plugin-sdk'
import * as SDKI18n from '@kite-dev/plugin-sdk/i18n'
import * as SDKNavigation from '@kite-dev/plugin-sdk/navigation'
import { version as sdkVersion } from '@kite-dev/plugin-sdk/package.json'
import { createInstance } from '@module-federation/runtime'
import * as RuntimeCore from '@module-federation/runtime/core'
import * as ReactQuery from '@tanstack/react-query'
import { version as queryVersion } from '@tanstack/react-query/package.json'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as ReactI18n from 'react-i18next'
import { version as i18nVersion } from 'react-i18next/package.json'
import * as ReactRouter from 'react-router-dom'
import { version as routerVersion } from 'react-router-dom/package.json'

import * as API from './exports/api'
import * as Hooks from './exports/hooks'
import * as Observability from './exports/observability'
import * as Resources from './exports/resources'
import * as UI from './exports/ui'

Object.assign(globalThis, { _FEDERATION_RUNTIME_CORE: RuntimeCore })

const shared = (version: string, lib: () => Record<string, unknown>) => ({
  version,
  lib,
  shareConfig: { singleton: true, requiredVersion: false as const },
})

// Only plugin loading imports this module; the main app starts without federation.
export const federationHost = createInstance({
  name: 'kite',
  remotes: [],
  shareStrategy: 'loaded-first',
  shared: {
    react: shared(React.version, () => React),
    'react/jsx-runtime': shared(React.version, () => JSXRuntime),
    'react/jsx-dev-runtime': shared(React.version, () => JSXDevRuntime),
    'react-dom': shared(ReactDOM.version, () => ReactDOM),
    'react-dom/client': shared(ReactDOM.version, () => ReactDOMClient),
    'react-router-dom': shared(routerVersion, () => ReactRouter),
    '@tanstack/react-query': shared(queryVersion, () => ReactQuery),
    'react-i18next': shared(i18nVersion, () => ReactI18n),
    '@kite-dev/plugin-sdk': shared(sdkVersion, () => SDK),
    '@kite-dev/plugin-sdk/resources': shared(
      sdkVersion,
      () => Resources satisfies typeof import('@kite-dev/plugin-sdk/resources')
    ),
    '@kite-dev/plugin-sdk/ui': shared(
      sdkVersion,
      () => UI satisfies typeof import('@kite-dev/plugin-sdk/ui')
    ),
    '@kite-dev/plugin-sdk/navigation': shared(sdkVersion, () => SDKNavigation),
    '@kite-dev/plugin-sdk/i18n': shared(sdkVersion, () => SDKI18n),
    '@kite-dev/plugin-sdk/api': shared(
      sdkVersion,
      () => API satisfies typeof import('@kite-dev/plugin-sdk/api')
    ),
    '@kite-dev/plugin-sdk/hooks': shared(
      sdkVersion,
      () => Hooks satisfies typeof import('@kite-dev/plugin-sdk/hooks')
    ),
    '@kite-dev/plugin-sdk/observability': shared(
      sdkVersion,
      () =>
        Observability satisfies typeof import('@kite-dev/plugin-sdk/observability')
    ),
  },
})
