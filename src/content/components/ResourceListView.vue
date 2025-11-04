<template>
  <template v-if="items.length">
    <label
      v-for="item in items"
      :key="item.id"
      class="chaospace-item"
      :data-id="item.id"
      :class="itemClasses(item)"
    >
      <input
        type="checkbox"
        class="chaospace-item-checkbox"
        :checked="item.isSelected"
      />
      <div class="chaospace-item-body">
        <div class="chaospace-item-title">{{ item.displayTitle }}</div>
        <div class="chaospace-item-meta">
          <span
            v-for="(badge, index) in item.badges"
            :key="index"
            :class="badge.className"
          >
            {{ badge.label }}
          </span>
        </div>
      </div>
    </label>
  </template>
  <div v-else class="chaospace-empty">{{ emptyMessage }}</div>
</template>

<script setup lang="ts">
// @ts-nocheck
import { computed } from 'vue';

export interface ResourceBadgeView {
  label: string;
  className: string;
}

export interface ResourceListItemView {
  id: string | number;
  displayTitle: string;
  isSelected: boolean;
  isTransferred: boolean;
  isNew: boolean;
  badges: ResourceBadgeView[];
}

const props = defineProps<{
  items: ResourceListItemView[];
  emptyMessage: string;
}>();

function itemClasses(item: ResourceListItemView): Record<string, boolean> {
  return {
    'is-visible': true,
    'is-muted': !item.isSelected,
    'is-transferred': item.isTransferred,
    'is-new': item.isNew
  };
}

const emptyMessage = computed(() => props.emptyMessage);
</script>
