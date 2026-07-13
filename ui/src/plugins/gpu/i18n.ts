// Plugin-owned translations, registered at module load so the core i18n
// files stay untouched.
import i18n from '@/i18n'

const en = {
  nav: { gpu: 'GPU' },
  plugin: {
    gpu: {
      title: 'GPU Overview',
      totalGpus: 'Total GPUs',
      allocated: 'Allocated',
      free: 'Free',
      idle: 'Idle',
      utilization: 'Utilization',
      memory: 'Memory',
      occupiedBy: 'Occupied by',
      modeBasic: 'Scheduler view',
      modeDcgm: 'Live (DCGM)',
      basicModeHint:
        'Estimated from resource requests, not actual card binding. Install dcgm-exporter for per-card live data.',
      syntheticSlotHint:
        'Synthetic slot estimated from resource requests, not an actual card binding.',
      noGpuInCluster: 'No GPU detected in this cluster.',
      unassignedCards: 'Unassigned cards',
      failedToLoad: 'Failed to load GPU overview',
      nodeNotReady: 'NotReady',
      resetGpu: 'Reset GPU',
      resetTitle: 'Reset GPU on {{node}}',
      resetDescription:
        'Deletes the NVIDIA device-plugin pod on this node; its DaemonSet recreates it and re-registers the GPUs. Running workloads keep their GPUs.',
      resetWillDelete: 'The following pod(s) will be deleted:',
      resetConfirm: 'Delete & Reset',
      resetting: 'Resetting...',
      resetSuccess: 'Device plugin pod deleted: {{pods}}. GPUs will re-register shortly.',
    },
  },
}

const zh = {
  nav: { gpu: 'GPU' },
  plugin: {
    gpu: {
      title: 'GPU 總覽',
      totalGpus: '總卡數',
      allocated: '已佔用',
      free: '空閒',
      idle: '空閒',
      utilization: '使用率',
      memory: '顯存',
      occupiedBy: '佔用者',
      modeBasic: '排程視圖',
      modeDcgm: '即時(DCGM)',
      basicModeHint:
        '依 resource requests 推算,非實際綁定。安裝 dcgm-exporter 可顯示每張卡的即時資料。',
      syntheticSlotHint: '依 resource requests 推算的合成卡格,非實際卡綁定。',
      noGpuInCluster: '此叢集未偵測到 GPU。',
      unassignedCards: '未歸屬節點的卡',
      failedToLoad: '載入 GPU 總覽失敗',
      nodeNotReady: 'NotReady',
      resetGpu: '重置 GPU',
      resetTitle: '重置 {{node}} 的 GPU',
      resetDescription:
        '刪除此節點上的 NVIDIA device-plugin pod,DaemonSet 會自動重建並重新註冊 GPU。執行中的工作負載不受影響。',
      resetWillDelete: '將刪除以下 pod:',
      resetConfirm: '刪除並重置',
      resetting: '重置中...',
      resetSuccess: '已刪除 device plugin pod:{{pods}},GPU 將在稍後重新註冊。',
    },
  },
}

i18n.addResourceBundle('en', 'translation', en, true, false)
i18n.addResourceBundle('zh', 'translation', zh, true, false)
