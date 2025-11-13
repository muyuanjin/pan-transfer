<template>
  <div class="chaospace-provider-status">
    <span class="chaospace-provider-value">{{ activeProviderLabel }}</span>
    <div v-if="activeProviderHosts.length" class="chaospace-provider-hosts">
      支持站点: {{ activeProviderHosts.join('、') }}
    </div>
    <label v-if="canSwitchProviders" class="chaospace-provider-select">
      <span class="chaospace-provider-select-label">首选解析器:</span>
      <select
        class="chaospace-provider-select-field"
        :disabled="isSwitching"
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

const activeProviderHosts = computed(() => activeProviderOption.value?.supportedHosts ?? [])

const availableProviderIds = computed(() => store.availableSiteProviderIds)
const canSwitchProviders = computed(() => selectableProviders.value.length > 1)
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
