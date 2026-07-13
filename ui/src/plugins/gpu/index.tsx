import { IconCpu2 } from '@tabler/icons-react'

import './i18n'

import type { KitePluginDescriptor } from '../types'
import { GpuPage } from './gpu-page'

export const gpuPlugin: KitePluginDescriptor = {
  name: 'gpu',
  route: { path: 'gpu', element: <GpuPage /> },
  sidebar: {
    titleKey: 'nav.gpu',
    icon: IconCpu2,
    url: '/gpu',
  },
}
