import type { PanelDomRefs } from '../../../types'
import type { ContentStore } from '../../../state'
import type { Binder } from './types'

interface SortingBinderDeps {
  panelDom: PanelDomRefs
  state: ContentStore
  renderResourceList: () => void
}

export function createSortingBinder({
  panelDom,
  state,
  renderResourceList,
}: SortingBinderDeps): Binder {
  return {
    bind(): () => void {
      const abort = new AbortController()
      const { signal } = abort

      if (panelDom.sortKeyGroup) {
        const buttons = Array.from(
          panelDom.sortKeyGroup.querySelectorAll<HTMLButtonElement>('[data-value]'),
        )
        const applySortActive = (value: 'page' | 'title') => {
          buttons.forEach((button) => {
            const buttonValue =
              button.dataset['value'] === 'title' ? ('title' as const) : ('page' as const)
            const isActive = buttonValue === value
            button.classList.toggle('is-active', isActive)
            button.setAttribute('aria-checked', isActive ? 'true' : 'false')
            button.tabIndex = isActive ? 0 : -1
          })
          panelDom.sortKeyGroup?.setAttribute('data-selected', value)
        }
        if (buttons.length) {
          applySortActive(state.sortKey)
        }
        buttons.forEach((button) => {
          const parseValue = (): 'page' | 'title' =>
            button.dataset['value'] === 'title' ? ('title' as const) : ('page' as const)
          button.addEventListener(
            'click',
            () => {
              const nextValue = parseValue()
              applySortActive(nextValue)
              if (state.sortKey !== nextValue) {
                state.sortKey = nextValue
                renderResourceList()
              }
            },
            { signal },
          )
          button.addEventListener(
            'keydown',
            (event) => {
              if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
                return
              }
              event.preventDefault()
              const currentIndex = buttons.indexOf(button)
              if (currentIndex === -1) {
                return
              }
              const delta = event.key === 'ArrowRight' ? 1 : -1
              const nextIndex = (currentIndex + delta + buttons.length) % buttons.length
              const nextButton = buttons[nextIndex]
              if (!nextButton) {
                return
              }
              const nextValue =
                nextButton.dataset['value'] === 'title' ? ('title' as const) : ('page' as const)
              applySortActive(nextValue)
              nextButton.focus()
              if (state.sortKey !== nextValue) {
                state.sortKey = nextValue
                renderResourceList()
              }
            },
            { signal },
          )
        })
      }

      if (panelDom.sortOrderButton) {
        const refreshOrderButton = () => {
          if (!panelDom.sortOrderButton) {
            return
          }
          panelDom.sortOrderButton.textContent = state.sortOrder === 'asc' ? '正序' : '倒序'
        }
        refreshOrderButton()
        panelDom.sortOrderButton.addEventListener(
          'click',
          () => {
            state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc'
            refreshOrderButton()
            renderResourceList()
          },
          { signal },
        )
      }

      return () => abort.abort()
    },
  }
}
