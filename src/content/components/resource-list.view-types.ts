export interface ResourceBadgeView {
  label: string
  className: string
}

export interface ResourceListItemView {
  id: string | number
  displayTitle: string
  isSelected: boolean
  isTransferred: boolean
  isNew: boolean
  badges: ResourceBadgeView[]
}
