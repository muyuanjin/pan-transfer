export function createResourceListRenderer({
  state,
  panelDom,
  renderSeasonTabs,
  filterItemsForActiveSeason,
  computeSeasonTabState,
  renderSeasonControls,
  updateTransferButton,
  updatePanelHeader
}) {
  function renderResourceSummary(context = {}) {
    if (!panelDom.resourceSummary) {
      return;
    }
    const total = state.items.length;
    const selected = state.selectedIds.size;
    const { tabState, visibleCount, visibleSelected } = context || {};
    const computedTabState = tabState || computeSeasonTabState({ syncState: false });
    const hasTabs = Array.isArray(computedTabState.tabItems) && computedTabState.tabItems.length > 0;

    let currentVisibleCount = typeof visibleCount === 'number' ? visibleCount : total;
    let currentVisibleSelected = typeof visibleSelected === 'number' ? visibleSelected : selected;
    if (hasTabs) {
      const filtered = filterItemsForActiveSeason(state.items, computedTabState.activeId);
      if (typeof visibleCount !== 'number') {
        currentVisibleCount = filtered.length;
      }
      if (typeof visibleSelected !== 'number') {
        currentVisibleSelected = filtered.filter(item => state.selectedIds.has(item.id)).length;
      }
    }

    const parts = [`🧾 已选 ${selected} / ${total}`];
    if (hasTabs) {
      const activeTab = computedTabState.activeTab;
      if (activeTab && activeTab.type === 'all') {
        parts.push(`显示全部 ${currentVisibleCount}`);
      } else if (activeTab) {
        parts.push(`${activeTab.name} ${currentVisibleSelected}/${activeTab.count}`);
      } else {
        parts.push(`当前显示 ${currentVisibleCount}`);
      }
    }

    if (state.newItemIds.size) {
      parts.push(`新增 ${state.newItemIds.size}`);
    }
    const seasonIds = new Set(state.items.map(item => item.seasonId).filter(Boolean));
    if (seasonIds.size > 1) {
      parts.push(`涵盖 ${seasonIds.size} 季`);
    }
    if (state.isSeasonLoading && state.seasonLoadProgress.total > 0) {
      parts.push(`⏳ 加载 ${state.seasonLoadProgress.loaded}/${state.seasonLoadProgress.total}`);
    }
    if (state.completion && state.completion.label) {
      const stateEmoji = state.completion.state === 'completed'
        ? '✅'
        : (state.completion.state === 'ongoing' ? '📡' : (state.completion.state === 'upcoming' ? '🕒' : 'ℹ️'));
      parts.push(`${stateEmoji} ${state.completion.label}`);
    }
    panelDom.resourceSummary.textContent = parts.join(' · ');
    if (panelDom.resourceTitle) {
      panelDom.resourceTitle.textContent = `🔍 找到 ${total} 个百度网盘资源`;
    }
  }

  function sortItems(items) {
    const sorted = [...items];
    if (state.sortKey === 'title') {
      sorted.sort((a, b) => {
        const compare = a.title.localeCompare(b.title, 'zh-CN');
        return state.sortOrder === 'asc' ? compare : -compare;
      });
    } else {
      sorted.sort((a, b) => {
        const compare = a.order - b.order;
        return state.sortOrder === 'asc' ? compare : -compare;
      });
    }
    return sorted;
  }

  function renderResourceList() {
    if (!panelDom.itemsContainer) {
      return;
    }
    const tabState = renderSeasonTabs();
    const container = panelDom.itemsContainer;
    container.innerHTML = '';

    const hasAnyItems = state.items.length > 0;
    const hasTabs = Array.isArray(tabState.tabItems) && tabState.tabItems.length > 0;
    const filteredItems = hasTabs
      ? filterItemsForActiveSeason(state.items, tabState.activeId)
      : [...state.items];

    let visibleSelected = 0;

    if (!filteredItems.length) {
      const empty = document.createElement('div');
      empty.className = 'chaospace-empty';

      if (!hasAnyItems) {
        if (state.isSeasonLoading) {
          const { loaded, total } = state.seasonLoadProgress;
          const progress = total > 0 ? ` (${loaded}/${total})` : '';
          empty.textContent = `⏳ 正在加载多季资源${progress}...`;
        } else {
          empty.textContent = '😅 没有解析到百度网盘资源';
        }
      } else if (state.isSeasonLoading && tabState.activeTab && tabState.activeTab.type === 'season') {
        const { loaded, total } = state.seasonLoadProgress;
        const progress = total > 0 ? ` (${loaded}/${total})` : '';
        empty.textContent = `⏳ ${tabState.activeTab.name} 正在加载${progress}...`;
      } else {
        const label = tabState.activeTab ? tabState.activeTab.name : '当前标签';
        empty.textContent = `😴 ${label} 暂无资源`;
      }

      container.appendChild(empty);
      renderResourceSummary({
        tabState,
        visibleCount: filteredItems.length,
        visibleSelected
      });
      updateTransferButton();
      updatePanelHeader();
      renderSeasonControls();
      return;
    }

    const sortedItems = sortItems(filteredItems);
    const fragment = document.createDocumentFragment();

    sortedItems.forEach(item => {
      const isSelected = state.selectedIds.has(item.id);
      const isTransferred = state.transferredIds.has(item.id);
      const isNew = state.currentHistory && state.newItemIds.has(item.id);
      if (isSelected) {
        visibleSelected += 1;
      }
      const statusBadges = [];
      if (isTransferred) {
        statusBadges.push('<span class="chaospace-badge chaospace-badge-success">已转存</span>');
      }
      if (isNew) {
        statusBadges.push('<span class="chaospace-badge chaospace-badge-new">新增</span>');
      }
      if (!isTransferred && !isNew && state.currentHistory) {
        statusBadges.push('<span class="chaospace-badge chaospace-badge-pending">待转存</span>');
      }
      const detailBadges = [];
      if (item.seasonLabel) {
        detailBadges.push(`<span class="chaospace-badge">季：${item.seasonLabel}</span>`);
      }
      if (item.seasonCompletion && item.seasonCompletion.label) {
        const badgeClass = item.seasonCompletion.state === 'completed'
          ? 'chaospace-badge chaospace-badge-success'
          : 'chaospace-badge';
        detailBadges.push(`<span class="${badgeClass}">状态：${item.seasonCompletion.label}</span>`);
      }
      if (item.quality) {
        detailBadges.push(`<span class="chaospace-badge">画质：${item.quality}</span>`);
      }
      if (item.subtitle) {
        detailBadges.push(`<span class="chaospace-badge">字幕：${item.subtitle}</span>`);
      }
      const metaBadges = [...statusBadges, ...detailBadges].join('');
      const displayTitle = item.seasonLabel ? `🔗 [${item.seasonLabel}] ${item.title}` : `🔗 ${item.title}`;
      const row = document.createElement('label');
      row.className = 'chaospace-item';
      row.dataset.id = item.id;
      row.innerHTML = `
        <input type="checkbox" class="chaospace-item-checkbox" ${isSelected ? 'checked' : ''} />
        <div class="chaospace-item-body">
          <div class="chaospace-item-title">${displayTitle}</div>
          <div class="chaospace-item-meta">${metaBadges}</div>
        </div>
      `;
      fragment.appendChild(row);
      requestAnimationFrame(() => {
        row.classList.add('is-visible');
        row.classList.toggle('is-muted', !isSelected);
        row.classList.toggle('is-transferred', isTransferred);
        row.classList.toggle('is-new', isNew);
      });
    });

    container.appendChild(fragment);

    renderResourceSummary({
      tabState,
      visibleCount: sortedItems.length,
      visibleSelected
    });
    updateTransferButton();
    updatePanelHeader();
    renderSeasonControls();
  }

  return {
    renderResourceList,
    renderResourceSummary
  };
}
