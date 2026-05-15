import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { HelmChart } from '@/types/api'
import { useArtifactHubCharts, useHelmCharts } from '@/lib/api'
import { translateError } from '@/lib/utils'

export function isSameHelmVersion(left?: string, right?: string) {
  return normalizeHelmVersion(left) === normalizeHelmVersion(right)
}

function normalizeHelmVersion(version?: string) {
  return version?.trim().replace(/^v/i, '') || ''
}

export function useHelmReleaseChartSelection({
  chartName,
  currentVersion,
  open,
  selectedRepository,
}: {
  chartName: string
  currentVersion: string
  open: boolean
  selectedRepository: string
}) {
  const { t } = useTranslation()
  const chartsQuery = useHelmCharts({
    query: chartName,
    enabled: open && !!chartName,
  })
  const managedChartCandidates = useMemo(
    () =>
      (chartsQuery.data?.items || []).filter(
        (chart) => chart.name === chartName
      ),
    [chartName, chartsQuery.data?.items]
  )
  const shouldSearchArtifactHub =
    open &&
    !!chartName &&
    !chartsQuery.isLoading &&
    managedChartCandidates.length === 0
  const verifiedArtifactHubQuery = useArtifactHubCharts({
    query: chartName,
    verifiedPublisher: true,
    limit: 20,
    enabled: shouldSearchArtifactHub,
  })
  const verifiedArtifactHubCandidates = useMemo(
    () =>
      (verifiedArtifactHubQuery.data?.items || []).filter(
        (chart) => chart.name === chartName
      ),
    [chartName, verifiedArtifactHubQuery.data?.items]
  )
  const artifactHubQuery = useArtifactHubCharts({
    query: chartName,
    verifiedPublisher: false,
    limit: 20,
    enabled: shouldSearchArtifactHub,
  })
  const artifactHubCandidates = useMemo(
    () =>
      (artifactHubQuery.data?.items || []).filter(
        (chart) => chart.name === chartName
      ),
    [artifactHubQuery.data?.items, chartName]
  )
  const chartCandidates =
    managedChartCandidates.length > 0
      ? managedChartCandidates
      : artifactHubCandidates
  const chartKey = (chart: HelmChart) =>
    `${chart.source || 'repository'}:${chart.repositoryName}`
  const selectedChart = chartCandidates.find(
    (chart) => chartKey(chart) === selectedRepository
  )
  const currentVersionChart = chartCandidates.find((chart) =>
    isSameHelmVersion(chart.version, currentVersion)
  )
  const canAutoSelectChart =
    managedChartCandidates.length > 0 ||
    chartCandidates.length <= 1 ||
    !!currentVersionChart
  const activeChart =
    selectedChart ||
    currentVersionChart ||
    (canAutoSelectChart ? chartCandidates[0] : undefined)
  const activeChartSource = activeChart?.source || 'repository'
  const activeRepository = activeChart?.repositoryName || ''
  const isVerifiedArtifactHubChart = (chart: HelmChart) =>
    chart.source === 'artifacthub' &&
    verifiedArtifactHubCandidates.some(
      (candidate) => chartKey(candidate) === chartKey(chart)
    )
  const chartOptionSourceLabel = (chart: HelmChart) => {
    if (chart.source !== 'artifacthub') {
      return t('helmCharts.filters.repositories')
    }
    if (isVerifiedArtifactHubChart(chart)) {
      return t('helm.messages.chartSourceArtifactHubVerifiedShort', {
        defaultValue: 'Artifact Hub (verified)',
      })
    }
    return t('helmCharts.filters.artifactHub')
  }
  const isChartSourceLoading =
    chartsQuery.isLoading ||
    verifiedArtifactHubQuery.isLoading ||
    artifactHubQuery.isLoading
  const chartLookupError =
    chartsQuery.error ||
    verifiedArtifactHubQuery.error ||
    artifactHubQuery.error
      ? translateError(
          chartsQuery.error ||
            verifiedArtifactHubQuery.error ||
            artifactHubQuery.error,
          t
        )
      : !chartsQuery.isLoading &&
          !verifiedArtifactHubQuery.isLoading &&
          !artifactHubQuery.isLoading &&
          chartName &&
          chartCandidates.length === 0
        ? t('helm.messages.chartNotFound', {
            defaultValue:
              'Chart not found in managed Helm repositories or Artifact Hub.',
          })
        : ''
  const chartSourceLabel = activeChart
    ? activeChartSource === 'artifacthub'
      ? verifiedArtifactHubCandidates.some(
          (chart) => chartKey(chart) === chartKey(activeChart)
        )
        ? t('helm.messages.chartSourceArtifactHubVerified', {
            repository: activeRepository,
            defaultValue:
              'Using Artifact Hub chart from {{repository}} (verified publisher).',
          })
        : t('helm.messages.chartSourceArtifactHub', {
            repository: activeRepository,
            defaultValue: 'Using Artifact Hub chart from {{repository}}.',
          })
      : t('helm.messages.chartSourceManagedRepository', {
          repository: activeRepository,
          defaultValue: 'Using managed chart repository {{repository}}.',
        })
    : chartCandidates.length > 1
      ? t('helm.messages.chartSourceSelectChart', {
          defaultValue: 'Select a chart to use a different chart package.',
        })
      : t('helm.messages.chartSourceCurrentRelease', {
          defaultValue: 'Using the chart stored in the current release.',
        })

  return {
    chartName,
    chartCandidates,
    chartKey,
    chartOptionSourceLabel,
    selectedChart,
    currentVersionChart,
    activeChart,
    activeChartSource,
    activeRepository,
    isChartSourceLoading,
    chartLookupError,
    chartSourceLabel,
  }
}

export type HelmReleaseChartSelection = ReturnType<
  typeof useHelmReleaseChartSelection
>
