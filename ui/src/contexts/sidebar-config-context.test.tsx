import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SidebarConfigProvider,
  useSidebarConfig,
} from './sidebar-config-context'

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
}))

vi.mock('./auth-context', () => ({
  useAuth: mockUseAuth,
}))

const workloadsGroupId = 'sidebar-groups-workloads'
const trafficGroupId = 'sidebar-groups-traffic'
const workloadsPodsItemId = 'sidebar-groups-workloads--pods'
const customGroupId = 'custom-my-group'
const customGroupItemId = 'custom-my-group-widgets-example-com'

function SidebarConfigConsumer() {
  const {
    config,
    isLoading,
    toggleItemVisibility,
    toggleItemPin,
    toggleGroupVisibility,
    toggleGroupCollapse,
    createCustomGroup,
    addCRDToGroup,
    removeCRDToGroup,
    removeCustomGroup,
    moveGroup,
  } = useSidebarConfig()

  if (isLoading || !config) {
    return <div data-testid="loading">loading</div>
  }

  const sortedGroups = [...config.groups].sort((a, b) => a.order - b.order)
  const workloadsGroup = config.groups.find(
    (group) => group.id === workloadsGroupId
  )
  const customGroup = config.groups.find((group) => group.id === customGroupId)

  return (
    <div>
      <div data-testid="group-order">
        {sortedGroups.map((group) => group.id).join(',')}
      </div>
      <div data-testid="hidden-items">{config.hiddenItems.join(',')}</div>
      <div data-testid="pinned-items">{config.pinnedItems.join(',')}</div>
      <div data-testid="workloads-visible">
        {String(workloadsGroup?.visible)}
      </div>
      <div data-testid="workloads-collapsed">
        {String(workloadsGroup?.collapsed)}
      </div>
      <div data-testid="custom-groups">
        {config.groups
          .filter((group) => group.isCustom)
          .map((group) => group.id)
          .join(',')}
      </div>
      <div data-testid="custom-items">
        {customGroup?.items.map((item) => item.id).join(',') ?? ''}
      </div>

      <button type="button" onClick={() => toggleItemPin(workloadsPodsItemId)}>
        toggle default pin
      </button>
      <button
        type="button"
        onClick={() => toggleItemVisibility(workloadsPodsItemId)}
      >
        toggle default visibility
      </button>
      <button
        type="button"
        onClick={() => toggleGroupVisibility(workloadsGroupId)}
      >
        toggle workloads visibility
      </button>
      <button
        type="button"
        onClick={() => toggleGroupCollapse(workloadsGroupId)}
      >
        toggle workloads collapse
      </button>
      <button type="button" onClick={() => moveGroup(workloadsGroupId, 'up')}>
        move workloads up
      </button>
      <button type="button" onClick={() => moveGroup(workloadsGroupId, 'down')}>
        move workloads down
      </button>
      <button type="button" onClick={() => moveGroup(trafficGroupId, 'up')}>
        move traffic up
      </button>
      <button type="button" onClick={() => createCustomGroup('My Group')}>
        create custom group
      </button>
      <button
        type="button"
        onClick={() =>
          addCRDToGroup(customGroupId, 'widgets.example.com', 'Widget')
        }
      >
        add custom item
      </button>
      <button type="button" onClick={() => toggleItemPin(customGroupItemId)}>
        toggle custom pin
      </button>
      <button
        type="button"
        onClick={() => toggleItemVisibility(customGroupItemId)}
      >
        toggle custom visibility
      </button>
      <button
        type="button"
        onClick={() => removeCRDToGroup(customGroupId, customGroupItemId)}
      >
        remove custom item
      </button>
      <button type="button" onClick={() => removeCustomGroup(customGroupId)}>
        remove custom group
      </button>
    </div>
  )
}

async function renderProvider() {
  render(
    <SidebarConfigProvider>
      <SidebarConfigConsumer />
    </SidebarConfigProvider>
  )

  await waitFor(() =>
    expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
  )
}

describe('SidebarConfigProvider', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: null })
  })

  it('toggles default item pinning and visibility', async () => {
    await renderProvider()

    fireEvent.click(screen.getByRole('button', { name: 'toggle default pin' }))
    await waitFor(() =>
      expect(screen.getByTestId('pinned-items')).toHaveTextContent(
        workloadsPodsItemId
      )
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'toggle default visibility' })
    )
    await waitFor(() =>
      expect(screen.getByTestId('hidden-items')).toHaveTextContent(
        workloadsPodsItemId
      )
    )

    fireEvent.click(screen.getByRole('button', { name: 'toggle default pin' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'toggle default visibility' })
    )

    await waitFor(() => {
      expect(screen.getByTestId('pinned-items')).toBeEmptyDOMElement()
      expect(screen.getByTestId('hidden-items')).toBeEmptyDOMElement()
    })
  })

  it('toggles group visibility and collapsed state', async () => {
    await renderProvider()

    fireEvent.click(
      screen.getByRole('button', { name: 'toggle workloads visibility' })
    )
    await waitFor(() =>
      expect(screen.getByTestId('workloads-visible')).toHaveTextContent('false')
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'toggle workloads collapse' })
    )
    await waitFor(() =>
      expect(screen.getByTestId('workloads-collapsed')).toHaveTextContent(
        'true'
      )
    )
  })

  it('reorders groups and ignores invalid boundary moves', async () => {
    await renderProvider()

    expect(screen.getByTestId('group-order')).toHaveTextContent(
      [
        workloadsGroupId,
        trafficGroupId,
        'sidebar-groups-storage',
        'sidebar-groups-config',
        'sidebar-groups-security',
        'sidebar-groups-other',
      ].join(',')
    )

    fireEvent.click(screen.getByRole('button', { name: 'move workloads up' }))
    await waitFor(() =>
      expect(screen.getByTestId('group-order')).toHaveTextContent(
        [
          workloadsGroupId,
          trafficGroupId,
          'sidebar-groups-storage',
          'sidebar-groups-config',
          'sidebar-groups-security',
          'sidebar-groups-other',
        ].join(',')
      )
    )

    fireEvent.click(screen.getByRole('button', { name: 'move workloads down' }))
    await waitFor(() =>
      expect(screen.getByTestId('group-order')).toHaveTextContent(
        [
          trafficGroupId,
          workloadsGroupId,
          'sidebar-groups-storage',
          'sidebar-groups-config',
          'sidebar-groups-security',
          'sidebar-groups-other',
        ].join(',')
      )
    )

    fireEvent.click(screen.getByRole('button', { name: 'move traffic up' }))
    await waitFor(() =>
      expect(screen.getByTestId('group-order')).toHaveTextContent(
        [
          trafficGroupId,
          workloadsGroupId,
          'sidebar-groups-storage',
          'sidebar-groups-config',
          'sidebar-groups-security',
          'sidebar-groups-other',
        ].join(',')
      )
    )
  })

  it('creates a custom group and manages CRD items inside it', async () => {
    await renderProvider()

    fireEvent.click(screen.getByRole('button', { name: 'create custom group' }))
    await waitFor(() =>
      expect(screen.getByTestId('custom-groups')).toHaveTextContent(
        customGroupId
      )
    )

    fireEvent.click(screen.getByRole('button', { name: 'add custom item' }))
    await waitFor(() =>
      expect(screen.getByTestId('custom-items')).toHaveTextContent(
        customGroupItemId
      )
    )

    fireEvent.click(screen.getByRole('button', { name: 'toggle custom pin' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'toggle custom visibility' })
    )

    await waitFor(() => {
      expect(screen.getByTestId('pinned-items')).toHaveTextContent(
        customGroupItemId
      )
      expect(screen.getByTestId('hidden-items')).toHaveTextContent(
        customGroupItemId
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'remove custom item' }))
    await waitFor(() => {
      expect(screen.getByTestId('custom-items')).toBeEmptyDOMElement()
      expect(screen.getByTestId('pinned-items')).not.toHaveTextContent(
        customGroupItemId
      )
      expect(screen.getByTestId('hidden-items')).not.toHaveTextContent(
        customGroupItemId
      )
    })
  })

  it('removes a custom group and clears item state tied to it', async () => {
    await renderProvider()

    fireEvent.click(screen.getByRole('button', { name: 'create custom group' }))
    fireEvent.click(screen.getByRole('button', { name: 'add custom item' }))

    await waitFor(() =>
      expect(screen.getByTestId('custom-items')).toHaveTextContent(
        customGroupItemId
      )
    )

    fireEvent.click(screen.getByRole('button', { name: 'toggle custom pin' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'toggle custom visibility' })
    )

    await waitFor(() =>
      expect(screen.getByTestId('pinned-items')).toHaveTextContent(
        customGroupItemId
      )
    )

    fireEvent.click(screen.getByRole('button', { name: 'remove custom group' }))

    await waitFor(() => {
      expect(screen.getByTestId('custom-groups')).toBeEmptyDOMElement()
      expect(screen.getByTestId('custom-items')).toBeEmptyDOMElement()
      expect(screen.getByTestId('pinned-items')).not.toHaveTextContent(
        customGroupItemId
      )
      expect(screen.getByTestId('hidden-items')).not.toHaveTextContent(
        customGroupItemId
      )
    })
  })
})
