<template>
  <div class="chaospace-preset-list" :class="{ 'is-disabled': presetsDisabled }">
    <div v-for="preset in orderedPresets" :key="preset" class="chaospace-chip-group">
      <button
        type="button"
        class="chaospace-chip-button"
        :class="{ 'is-active': preset === activeBaseDir }"
        :data-action="presetsDisabled ? undefined : 'select'"
        :data-value="preset"
        :disabled="presetsDisabled"
        @click="handleSelect(preset)"
      >
        {{ preset }}
      </button>
      <button
        v-if="isRemovable(preset)"
        type="button"
        class="chaospace-chip-remove"
        :disabled="presetsDisabled"
        :aria-label="`移除 ${preset}`"
        @click.stop="handleRemove(preset)"
      >
        ×
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { DEFAULT_PRESETS } from '../constants'
import { useContentStore } from '../state'
import { panelPreferencesContextKey } from '../runtime/ui/panel-preferences-context'

const preferences = inject(panelPreferencesContextKey)

if (!preferences) {
  throw new Error('[Chaospace Transfer] Panel preferences context is missing')
}

const store = useContentStore()

const presetsDisabled = computed(() => store.presetsDisabled)
const activeBaseDir = computed(() => store.baseDir)

const orderedPresets = computed(() => {
  return Array.from(new Set(['/', ...store.presets]))
})

const isRemovable = (value: string): boolean => {
  return value !== '/' && !DEFAULT_PRESETS.includes(value)
}

const handleSelect = (value: string): void => {
  if (presetsDisabled.value) {
    return
  }
  preferences.setBaseDir(value, { fromPreset: true })
}

const handleRemove = (value: string): void => {
  if (presetsDisabled.value) {
    return
  }
  preferences.removePreset(value)
}
</script>
