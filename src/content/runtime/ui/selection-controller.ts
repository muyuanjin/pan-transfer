import { state } from '../../state'
import { computeSeasonTabState, filterItemsForActiveSeason } from '../../services/season-manager'

export interface SelectionController {
  selectAll: (selected: boolean) => void
  invert: () => void
}

export function createSelectionController(deps: {
  renderResourceList: () => void
}): SelectionController {
  const selectAll = (selected: boolean): void => {
    const { tabItems, activeId } = computeSeasonTabState({ syncState: true })
    const hasTabs = Array.isArray(tabItems) && tabItems.length > 0
    const visibleItems = hasTabs ? filterItemsForActiveSeason(state.items, activeId) : state.items
    const visibleIds = visibleItems.map((item) => item?.id).filter(Boolean) as Array<
      string | number
    >

    if (selected) {
      visibleIds.forEach((id) => state.selectedIds.add(id))
    } else if (visibleIds.length) {
      visibleIds.forEach((id) => state.selectedIds.delete(id))
    } else if (!hasTabs) {
      state.selectedIds.clear()
    }
    deps.renderResourceList()
  }

  const invert = (): void => {
    const { tabItems, activeId } = computeSeasonTabState({ syncState: true })
    const hasTabs = Array.isArray(tabItems) && tabItems.length > 0
    const visibleItems = hasTabs ? filterItemsForActiveSeason(state.items, activeId) : state.items
    if (!visibleItems.length) {
      deps.renderResourceList()
      return
    }
    const next = new Set(state.selectedIds)
    visibleItems.forEach((item) => {
      if (!item?.id) {
        return
      }
      if (next.has(item.id)) {
        next.delete(item.id)
      } else {
        next.add(item.id)
      }
    })
    state.selectedIds = next
    deps.renderResourceList()
  }

  return {
    selectAll,
    invert,
  }
}
