<template>
  <div class="chaospace-provider-status">
    <span ref="providerValueRef" class="chaospace-provider-value">{{ activeProviderLabel }}</span>
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
import { computed, inject, ref, watch, nextTick } from 'vue'
import { useContentStore } from '../state'
import { providerPanelContextKey } from '../runtime/ui/provider-context'

const providerValueRef = ref<HTMLElement | null>(null)

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

// 动态调整字体大小和 letter-spacing 以匹配标题宽度
watch(
  activeProviderLabel,
  () => {
    void nextTick(() => {
      const providerEl = providerValueRef.value
      if (!providerEl) return

      const titleEl = document.querySelector('.chaospace-show-title') as HTMLElement | null
      if (!titleEl) return

      // 先重置样式以获取原始宽度
      providerEl.style.fontSize = ''
      providerEl.style.letterSpacing = ''

      void nextTick(() => {
        const titleWidth = titleEl.offsetWidth
        const providerWidth = providerEl.offsetWidth

        if (titleWidth <= 0 || providerWidth <= 0) return

        const textLength = activeProviderLabel.value.length
        if (textLength <= 1) return

        // 目标：让 provider 的宽度接近 title 的宽度
        // 策略：通过调整字体大小来缩小差距，再用字间距微调

        const baseFontSize = 18
        const baseLetterSpacing = 0.2

        // 计算理想的字体大小：按宽度比例直接缩放
        const targetFontSize = baseFontSize * (titleWidth / providerWidth)

        // 限制字体大小在合理范围内 (14px ~ 26px)
        const clampedFontSize = Math.max(14, Math.min(26, targetFontSize))

        providerEl.style.fontSize = `${clampedFontSize}px`

        void nextTick(() => {
          const newProviderWidth = providerEl.offsetWidth
          if (newProviderWidth <= 0) return

          // 用字间距补偿剩余差异
          const remainingDiff = titleWidth - newProviderWidth
          const spacingAdjust = remainingDiff / (textLength - 1)

          // 限制字间距调整范围 (-1px ~ 3px)
          const finalSpacing = Math.max(-1, Math.min(3, baseLetterSpacing + spacingAdjust))

          providerEl.style.letterSpacing = `${finalSpacing}px`
        })
      })
    })
  },
  { immediate: true },
)
</script>
