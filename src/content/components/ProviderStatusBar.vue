<template>
  <div class="chaospace-provider-panel">
    <div class="chaospace-provider-overview">
      <div class="chaospace-provider-label">
        🔌 解析来源 · {{ activeProviderLabel }}
        <span class="chaospace-provider-mode">（{{ modeLabel }}）</span>
      </div>
      <div v-if="activeProviderTags.length" class="chaospace-provider-tags">
        <span v-for="tag in activeProviderTags" :key="tag" class="chaospace-provider-tag">
          #{{ tag }}
        </span>
      </div>
      <div v-if="activeProviderHosts.length" class="chaospace-provider-hosts">
        支持站点：{{ activeProviderHosts.join('、') }}
      </div>
    </div>
    <label class="chaospace-provider-select">
      <span>首选解析器</span>
      <select
        :disabled="isSwitching || !canSwitchProviders"
        :value="selectedProviderId"
        @change="handleChange"
      >
        <option value="">自动检测</option>
        <option v-for="option in selectableProviders" :key="option.id" :value="option.id">
          {{ option.label }}
        </option>
      </select>
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { useContentStore } from '../state'
import { providerPanelContextKey } from '../runtime/ui/provider-context'

const store = useContentStore()
const providerContext = inject(providerPanelContextKey)

if (!providerContext) {
  throw new Error('[Pan Transfer] Provider context is missing')
}

const selectableProviders = computed(() => {
  const disabled = store.disabledSiteProviderIds
  const available = store.availableSiteProviderIds
  return providerContext.siteProviderOptions.filter((option) => {
    if (disabled?.has(option.id)) {
      return false
    }
    if (available && available.size > 0 && !available.has(option.id)) {
      return false
    }
    return true
  })
})

const providerMap = computed(() => {
  const map = new Map<string, (typeof providerContext.siteProviderOptions)[number]>()
  providerContext.siteProviderOptions.forEach((option) => {
    map.set(option.id, option)
  })
  return map
})

const activeProviderOption = computed(() => {
  const id = store.activeSiteProviderId
  if (!id) {
    return null
  }
  return providerMap.value.get(id) ?? null
})

const activeProviderLabel = computed(() => {
  return (
    activeProviderOption.value?.label ||
    store.activeSiteProviderLabel ||
    store.activeSiteProviderId ||
    'CHAOSPACE'
  )
})

const activeProviderTags = computed(() => activeProviderOption.value?.tags ?? [])

const activeProviderHosts = computed(() => activeProviderOption.value?.supportedHosts ?? [])

const availableProviderIds = computed(() => store.availableSiteProviderIds)
const canSwitchProviders = computed(() => selectableProviders.value.length > 1)
const modeLabel = computed(() => (store.manualSiteProviderId ? '手动' : '自动'))
const selectedProviderId = computed(() => store.manualSiteProviderId || '')
const isSwitching = computed(() => store.providerSwitching)

const handleChange = (event: Event): void => {
  const target = event.target as HTMLSelectElement | null
  if (!target) {
    return
  }
  const value = target.value?.trim() || ''
  if (value && availableProviderIds.value.size > 0 && !availableProviderIds.value.has(value)) {
    return
  }
  void providerContext.switchSiteProvider(value || null)
}
</script>
