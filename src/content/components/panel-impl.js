import { createApp } from 'vue';
import PanelRoot from './PanelRoot.vue';
import { disableElementDrag } from '../utils/dom';
import { safeStorageGet, safeStorageSet } from '../utils/storage';

const PANEL_MARGIN = 16;
const PANEL_MIN_WIDTH = 360;
const PANEL_MIN_HEIGHT = 380;

export async function mountPanelShell({
  document,
  window,
  panelDom,
  panelState,
  pageTitle,
  originLabel,
  theme,
  handleDocumentPointerDown,
  constants,
  storageKeys
}) {
  const {
    EDGE_HIDE_DELAY,
    EDGE_HIDE_DEFAULT_PEEK,
    EDGE_HIDE_MIN_PEEK,
    EDGE_HIDE_MAX_PEEK
  } = constants;
  const { POSITION_KEY, SIZE_KEY } = storageKeys;

  const host = document.createElement('div');
  host.className = 'chaospace-panel-host';
  document.body.appendChild(host);

  const vueApp = createApp(PanelRoot, {
    pageTitle,
    originLabel,
    theme
  });
  vueApp.mount(host);
  const panel = host.querySelector('.chaospace-float-panel');
  if (!(panel instanceof window.HTMLElement)) {
    vueApp.unmount();
    host.remove();
    throw new Error('[Chaospace Transfer] Failed to mount floating panel');
  }

  const handlePanelIntroEnd = (event) => {
    if (event.animationName === 'chaospace-panel-in') {
      panel.classList.add('is-mounted');
      panel.removeEventListener('animationend', handlePanelIntroEnd);
    }
  };
  panel.addEventListener('animationend', handlePanelIntroEnd);

  const shouldEdgeHideOnMount = true;
  panelState.edgeState = { isHidden: shouldEdgeHideOnMount, side: 'right', peek: EDGE_HIDE_DEFAULT_PEEK };
  panelState.pointerInside = false;
  panelState.lastPointerPosition = { x: Number.NaN, y: Number.NaN };
  panelState.isPinned = false;
  if (panelState.hideTimer) {
    clearTimeout(panelState.hideTimer);
    panelState.hideTimer = null;
  }
  panel.style.transition = 'none';
  if (!panelState.documentPointerDownBound) {
    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    panelState.documentPointerDownBound = true;
  }

  const clamp = (value, min, max) => {
    return Math.min(Math.max(value, min), max);
  };

  let lastKnownPosition = { left: PANEL_MARGIN, top: PANEL_MARGIN };
  let isDragging = false;
  let isResizing = false;
  let currentX = 0;
  let currentY = 0;
  let initialX = 0;
  let initialY = 0;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartWidth = 0;
  let resizeStartHeight = 0;
  let resizeAnchorRight = 0;

  const updatePointerPosition = (event) => {
    if (!event) {
      return;
    }
    panelState.lastPointerPosition.x = event.clientX;
    panelState.lastPointerPosition.y = event.clientY;
  };

  const isPointerLikelyInsidePanel = () => {
    if (!panel || !panel.isConnected) {
      return false;
    }
    const { x, y } = panelState.lastPointerPosition;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return false;
    }
    const hoveredElement = document.elementFromPoint(x, y);
    if (hoveredElement && panel.contains(hoveredElement)) {
      return true;
    }
    const rect = panel.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  };

  const computeEdgePeek = () => {
    const width = panel.offsetWidth || PANEL_MIN_WIDTH;
    const derived = Math.round(width * 0.18);
    const normalized = Number.isFinite(derived) ? derived : EDGE_HIDE_DEFAULT_PEEK;
    const viewportWidth = Math.max(window.innerWidth || 0, 0);
    const baseMax = Math.max(16, viewportWidth - 8);
    const dynamicMax = Math.max(16, Math.min(EDGE_HIDE_MAX_PEEK, baseMax));
    const dynamicMin = Math.min(EDGE_HIDE_MIN_PEEK, dynamicMax);
    return Math.max(dynamicMin, Math.min(dynamicMax, normalized));
  };

  const determineDockSide = () => {
    const panelCenter = lastKnownPosition.left + panel.offsetWidth / 2;
    const viewportCenter = window.innerWidth / 2;
    return panelCenter < viewportCenter ? 'left' : 'right';
  };

  const getPanelBounds = () => {
    const availableWidth = window.innerWidth - PANEL_MARGIN * 2;
    const availableHeight = window.innerHeight - PANEL_MARGIN * 2;
    const maxWidth = Math.max(PANEL_MIN_WIDTH, availableWidth);
    const maxHeight = Math.max(PANEL_MIN_HEIGHT, availableHeight);
    return {
      minWidth: PANEL_MIN_WIDTH,
      minHeight: PANEL_MIN_HEIGHT,
      maxWidth,
      maxHeight
    };
  };

  const syncPanelLayout = () => {
    const width = panel.offsetWidth;
    panel.classList.toggle('is-narrow', width < 620);
    panel.classList.toggle('is-compact', width < 520);
  };

  const applyEdgeHiddenPosition = () => {
    if (!panelState.edgeState) {
      panelState.edgeState = { isHidden: false, side: 'right', peek: EDGE_HIDE_DEFAULT_PEEK };
    }
    const shouldHide = panelState.edgeState.isHidden && !panelState.isPinned;
    panel.classList.toggle('is-edge-left', panelState.edgeState.side === 'left');
    panel.classList.toggle('is-edge-right', panelState.edgeState.side === 'right');
    if (!shouldHide) {
      panelState.edgeState.isHidden = false;
      panel.classList.remove('is-edge-hidden');
      panel.classList.remove('is-leaving');
      panel.style.left = `${lastKnownPosition.left}px`;
      panel.style.top = `${lastKnownPosition.top}px`;
      panel.style.right = 'auto';
      panel.style.removeProperty('--chaospace-edge-peek');
      return;
    }

    const peek = computeEdgePeek();
    panelState.edgeState.peek = peek;
    panel.style.setProperty('--chaospace-edge-peek', `${peek}px`);

    const panelHeight = panel.offsetHeight;
    const maxTop = Math.max(PANEL_MARGIN, window.innerHeight - panelHeight - PANEL_MARGIN);
    const safeTop = clamp(lastKnownPosition.top, PANEL_MARGIN, maxTop);
    lastKnownPosition.top = safeTop;
    panel.style.top = `${safeTop}px`;

    let targetLeft;
    if (panelState.edgeState.side === 'left') {
      targetLeft = -(panel.offsetWidth - peek);
    } else {
      targetLeft = window.innerWidth - peek;
    }
    panel.style.left = `${targetLeft}px`;
    panel.style.right = 'auto';
    panel.classList.remove('is-hovering');
    panel.classList.add('is-edge-hidden');
  };

  const beginEdgeAnimation = () => {
    if (panelState.edgeTransitionUnbind) {
      panelState.edgeTransitionUnbind();
      panelState.edgeTransitionUnbind = null;
    }
    panel.classList.add('is-edge-animating');
    if (panelState.edgeAnimationTimer) {
      clearTimeout(panelState.edgeAnimationTimer);
      panelState.edgeAnimationTimer = null;
    }
    function cleanup() {
      panel.classList.remove('is-edge-animating');
      panel.removeEventListener('transitionend', handleTransitionEnd);
      if (panelState.edgeAnimationTimer) {
        clearTimeout(panelState.edgeAnimationTimer);
        panelState.edgeAnimationTimer = null;
      }
      panelState.edgeTransitionUnbind = null;
    }
    function handleTransitionEnd(event) {
      if (event.target !== panel) {
        return;
      }
      if (event.propertyName === 'left' || event.propertyName === 'transform') {
        cleanup();
      }
    }
    panel.addEventListener('transitionend', handleTransitionEnd);
    panelState.edgeAnimationTimer = window.setTimeout(() => {
      cleanup();
    }, 760);
    panelState.edgeTransitionUnbind = cleanup;
  };

  const showPanelFromEdge = () => {
    if (!panelState.edgeState.isHidden) {
      return;
    }
    panelState.edgeState.isHidden = false;
    panel.classList.remove('is-leaving');
    beginEdgeAnimation();
    applyEdgeHiddenPosition();
  };

  const hidePanelToEdge = () => {
    if (panelState.isPinned || isDragging || isResizing) {
      return;
    }
    panel.classList.remove('is-hovering');
    panelState.edgeState.side = determineDockSide();
    panelState.edgeState.isHidden = true;
    beginEdgeAnimation();
    applyEdgeHiddenPosition();
    panel.classList.remove('is-leaving');
  };

  const scheduleEdgeHide = (delay = EDGE_HIDE_DELAY) => {
    if (panelState.isPinned || isDragging || isResizing) {
      return;
    }
    if (panelState.hideTimer) {
      clearTimeout(panelState.hideTimer);
    }
    panelState.hideTimer = window.setTimeout(() => {
      panelState.hideTimer = null;
      const hasFocusWithin = panel.matches(':focus-within');
      if (!panelState.pointerInside && !hasFocusWithin) {
        hidePanelToEdge();
      }
    }, Math.max(0, delay));
  };

  const cancelEdgeHide = ({ show = false } = {}) => {
    if (panelState.hideTimer) {
      clearTimeout(panelState.hideTimer);
      panelState.hideTimer = null;
    }
    panel.classList.remove('is-leaving');
    if (show) {
      showPanelFromEdge();
    }
  };

  panelState.scheduleEdgeHide = scheduleEdgeHide;
  panelState.cancelEdgeHide = cancelEdgeHide;

  const applyPanelSize = (width, height) => {
    const bounds = getPanelBounds();
    const nextWidth = clamp(width, bounds.minWidth, bounds.maxWidth);
    const nextHeight = clamp(height, bounds.minHeight, bounds.maxHeight);
    panel.style.width = `${nextWidth}px`;
    panel.style.height = `${nextHeight}px`;
    panelState.lastKnownSize = { width: nextWidth, height: nextHeight };
    syncPanelLayout();
    panelState.edgeState.side = determineDockSide();
    applyEdgeHiddenPosition();
    return panelState.lastKnownSize;
  };

  const applyPanelPosition = (left, top) => {
    const panelWidth = panel.offsetWidth;
    const panelHeight = panel.offsetHeight;
    const maxLeft = Math.max(PANEL_MARGIN, window.innerWidth - panelWidth - PANEL_MARGIN);
    const maxTop = Math.max(PANEL_MARGIN, window.innerHeight - panelHeight - PANEL_MARGIN);
    const fallbackLeft = maxLeft;
    const fallbackTop = PANEL_MARGIN;
    const hasLeft = Number.isFinite(left);
    const hasTop = Number.isFinite(top);
    const safeLeft = clamp(hasLeft ? left : fallbackLeft, PANEL_MARGIN, maxLeft);
    const safeTop = clamp(hasTop ? top : fallbackTop, PANEL_MARGIN, maxTop);
    lastKnownPosition = { left: safeLeft, top: safeTop };
    panel.style.left = `${safeLeft}px`;
    panel.style.top = `${safeTop}px`;
    panel.style.right = 'auto';
    panelState.edgeState.side = determineDockSide();
    applyEdgeHiddenPosition();
    return lastKnownPosition;
  };

  const savedState = await safeStorageGet([POSITION_KEY, SIZE_KEY], 'panel geometry');
  const savedSize = savedState[SIZE_KEY];
  if (savedSize && Number.isFinite(savedSize.width) && Number.isFinite(savedSize.height)) {
    applyPanelSize(savedSize.width, savedSize.height);
  } else {
    const bounds = getPanelBounds();
    const fallbackWidth = Math.min(640, bounds.maxWidth);
    const fallbackHeight = Math.min(520, bounds.maxHeight);
    applyPanelSize(fallbackWidth, fallbackHeight);
  }

  const savedPosition = savedState[POSITION_KEY];
  lastKnownPosition = applyPanelPosition(
    savedPosition && Number.isFinite(savedPosition.left) ? savedPosition.left : undefined,
    savedPosition && Number.isFinite(savedPosition.top) ? savedPosition.top : undefined
  );

  if (shouldEdgeHideOnMount && !panelState.isPinned) {
    const dockSide = panelState.edgeState.side;
    const peekForMount = Number.isFinite(panelState.edgeState.peek)
      ? panelState.edgeState.peek
      : computeEdgePeek();
    const offscreenBuffer = Math.max(24, peekForMount + 24);
    const offscreenLeft = dockSide === 'right'
      ? window.innerWidth + offscreenBuffer
      : -(panel.offsetWidth + offscreenBuffer);
    panelState.edgeState.peek = peekForMount;
    panel.style.setProperty('--chaospace-edge-peek', `${peekForMount}px`);
    panel.style.left = `${offscreenLeft}px`;
    panel.style.right = 'auto';
    panel.classList.remove('is-hovering');
    panel.classList.remove('is-leaving');
    panel.classList.add('is-edge-hidden');
  }

  const finalizeInitialLayout = () => {
    panel.style.removeProperty('transition');
    if (shouldEdgeHideOnMount && !panelState.isPinned) {
      beginEdgeAnimation();
      applyEdgeHiddenPosition();
    } else if (shouldEdgeHideOnMount) {
      panelState.edgeState.isHidden = false;
      applyEdgeHiddenPosition();
    }
  };
  window.requestAnimationFrame(finalizeInitialLayout);

  panelDom.container = panel;
  panelDom.header = panel.querySelector('.chaospace-float-header');
  panelDom.headerArt = panel.querySelector('[data-role="header-art"]');
  panelDom.headerPoster = panel.querySelector('[data-role="header-poster"]');
  disableElementDrag(panelDom.headerPoster);
  panelDom.showTitle = panel.querySelector('[data-role="show-title"]');
  panelDom.showSubtitle = panel.querySelector('[data-role="show-subtitle"]');
  panelDom.baseDirInput = panel.querySelector('[data-role="base-dir"]');
  panelDom.useTitleCheckbox = panel.querySelector('[data-role="use-title"]');
  panelDom.useSeasonCheckbox = panel.querySelector('[data-role="use-season"]');
  panelDom.seasonRow = panel.querySelector('[data-role="season-row"]');
  panelDom.seasonPathHint = panel.querySelector('[data-role="season-path-hint"]');
  panelDom.pathPreview = panel.querySelector('[data-role="path-preview"]');
  panelDom.presetList = panel.querySelector('[data-role="preset-list"]');
  panelDom.addPresetButton = panel.querySelector('[data-role="add-preset"]');
  panelDom.themeToggle = panel.querySelector('[data-role="theme-toggle"]');
  panelDom.settingsToggle = panel.querySelector('[data-role="settings-toggle"]');
  panelDom.settingsOverlay = panel.querySelector('[data-role="settings-overlay"]');
  panelDom.settingsForm = panel.querySelector('[data-role="settings-form"]');
  panelDom.settingsClose = panel.querySelector('[data-role="settings-close"]');
  panelDom.settingsCancel = panel.querySelector('[data-role="settings-cancel"]');
  panelDom.settingsBaseDir = panel.querySelector('[data-role="settings-base-dir"]');
  panelDom.settingsUseTitle = panel.querySelector('[data-role="settings-use-title"]');
  panelDom.settingsUseSeason = panel.querySelector('[data-role="settings-use-season"]');
  panelDom.settingsTheme = panel.querySelector('[data-role="settings-theme"]');
  panelDom.settingsPresets = panel.querySelector('[data-role="settings-presets"]');
  panelDom.settingsHistoryRate = panel.querySelector('[data-role="settings-history-rate"]');
  panelDom.settingsExportConfig = panel.querySelector('[data-role="settings-export-config"]');
  panelDom.settingsExportData = panel.querySelector('[data-role="settings-export-data"]');
  panelDom.settingsImportConfigTrigger = panel.querySelector('[data-role="settings-import-config-trigger"]');
  panelDom.settingsImportDataTrigger = panel.querySelector('[data-role="settings-import-data-trigger"]');
  panelDom.settingsImportConfigInput = panel.querySelector('[data-role="settings-import-config"]');
  panelDom.settingsImportDataInput = panel.querySelector('[data-role="settings-import-data"]');
  panelDom.settingsResetLayout = panel.querySelector('[data-role="settings-reset-layout"]');
  panelDom.pinBtn = panel.querySelector('[data-role="pin-toggle"]');
  panelDom.logContainer = panel.querySelector('[data-role="log-container"]');
  panelDom.logList = panel.querySelector('[data-role="log-list"]');
  panelDom.resultSummary = panel.querySelector('[data-role="result-summary"]');
  panelDom.itemsContainer = panel.querySelector('[data-role="items"]');
  panelDom.sortKeySelect = panel.querySelector('[data-role="sort-key"]');
  panelDom.sortOrderButton = panel.querySelector('[data-role="sort-order"]');
  panelDom.historyOverlay = panel.querySelector('[data-role="history-overlay"]');
  panelDom.historyList = panel.querySelector('[data-role="history-list"]');
  panelDom.historyEmpty = panel.querySelector('[data-role="history-empty"]');
  panelDom.historySummary = panel.querySelector('[data-role="history-summary"]');
  panelDom.historySummaryBody = panel.querySelector('[data-role="history-summary-body"]');
  panelDom.historyControls = panel.querySelector('[data-role="history-controls"]');
  panelDom.historyTabs = panel.querySelector('[data-role="history-tabs"]');
  panelDom.historySelectAll = panel.querySelector('[data-role="history-select-all"]');
  panelDom.historySelectionCount = panel.querySelector('[data-role="history-selection-count"]');
  panelDom.historyBatchCheck = panel.querySelector('[data-role="history-batch-check"]');
  panelDom.historyDeleteSelected = panel.querySelector('[data-role="history-delete-selected"]');
  panelDom.historyClear = panel.querySelector('[data-role="history-clear"]');
  panelDom.historyToolbar = panel.querySelector('[data-role="history-toolbar"]');
  panelDom.historyToggleButtons = Array.from(panel.querySelectorAll('[data-role="history-toggle"]'));
  panelDom.resourceSummary = panel.querySelector('[data-role="resource-summary"]');
  panelDom.resourceTitle = panel.querySelector('[data-role="resource-title"]');
  panelDom.seasonTabs = panel.querySelector('[data-role="season-tabs"]');
  panelDom.transferBtn = panel.querySelector('[data-role="transfer-btn"]');
  panelDom.transferLabel = panel.querySelector('[data-role="transfer-label"]');
  panelDom.transferSpinner = panel.querySelector('[data-role="transfer-spinner"]');
  panelDom.resizeHandle = panel.querySelector('[data-role="resize-handle"]');

  panelState.applyEdgeHiddenPosition = applyEdgeHiddenPosition;
  panelState.hidePanelToEdge = hidePanelToEdge;
  panelState.showPanelFromEdge = showPanelFromEdge;
  panelState.beginEdgeAnimation = beginEdgeAnimation;
  panelState.lastKnownPosition = lastKnownPosition;
  panelState.getPanelBounds = getPanelBounds;

  const handlePointerEnter = (event) => {
    updatePointerPosition(event);
    panelState.pointerInside = true;
    panel.classList.add('is-hovering');
    panel.classList.remove('is-leaving');
    cancelEdgeHide({ show: true });
  };

  const handlePointerLeave = (event) => {
    updatePointerPosition(event);
    const verifyHoverState = () => {
      if (isDragging || isResizing) {
        panelState.pointerInside = true;
        panel.classList.add('is-hovering');
        panel.classList.remove('is-leaving');
        cancelEdgeHide({ show: true });
        return;
      }
      if (!panel || !panel.isConnected) {
        return;
      }
      const hasFocusWithin = panel.matches(':focus-within');
      if (hasFocusWithin || panel.matches(':hover') || isPointerLikelyInsidePanel()) {
        panelState.pointerInside = true;
        panel.classList.add('is-hovering');
        panel.classList.remove('is-leaving');
        cancelEdgeHide({ show: true });
        return;
      }
      panelState.pointerInside = false;
      panel.classList.remove('is-hovering');
      panel.classList.add('is-leaving');
      scheduleEdgeHide();
    };
    window.requestAnimationFrame(verifyHoverState);
  };

  const handleFocusIn = () => {
    panel.classList.add('is-hovering');
    panel.classList.remove('is-leaving');
    cancelEdgeHide({ show: true });
  };

  const handleFocusOut = (event) => {
    if (!panel.contains(event.relatedTarget)) {
      panel.classList.remove('is-hovering');
      panel.classList.add('is-leaving');
      scheduleEdgeHide();
    }
  };

  panel.addEventListener('pointerenter', handlePointerEnter);
  panel.addEventListener('pointermove', updatePointerPosition);
  panel.addEventListener('pointerdown', updatePointerPosition);
  panel.addEventListener('pointerup', updatePointerPosition);
  panel.addEventListener('pointerleave', handlePointerLeave);
  panel.addEventListener('focusin', handleFocusIn);
  panel.addEventListener('focusout', handleFocusOut);

  const header = panelDom.header;

  const startDrag = (event) => {
    if (event.button !== 0) {
      return;
    }
    if (event.target.closest('button') ||
        event.target.closest('input') ||
        event.target.closest('.chaospace-theme-toggle')) {
      return;
    }
    cancelEdgeHide({ show: true });
    panelState.edgeState.isHidden = false;
    panelState.pointerInside = true;
    applyEdgeHiddenPosition();
    isDragging = true;
    const rect = panel.getBoundingClientRect();
    initialX = event.clientX - rect.left;
    initialY = event.clientY - rect.top;
    panel.style.transition = 'none';
    document.body.style.userSelect = 'none';
    event.currentTarget.style.cursor = 'grabbing';
  };

  const startResize = (event) => {
    if (event.button !== 0 || !panelDom.resizeHandle) {
      return;
    }
    if (!panelDom.resizeHandle.contains(event.target)) {
      return;
    }
    cancelEdgeHide({ show: true });
    panelState.edgeState.isHidden = false;
    panelState.pointerInside = true;
    applyEdgeHiddenPosition();
    event.preventDefault();
    event.stopPropagation();
    isResizing = true;
    resizeStartWidth = panel.offsetWidth;
    resizeStartHeight = panel.offsetHeight;
    resizeStartX = event.clientX;
    resizeStartY = event.clientY;
    const rect = panel.getBoundingClientRect();
    resizeAnchorRight = rect.right;
    panel.classList.add('is-resizing');
    panel.style.transition = 'none';
    document.body.style.userSelect = 'none';
  };

  if (header) {
    header.addEventListener('mousedown', startDrag);
  }

  if (panelDom.resizeHandle) {
    panelDom.resizeHandle.addEventListener('mousedown', startResize);
  }

  const handleDocumentMouseMove = (event) => {
    if (isResizing) {
      event.preventDefault();
      const deltaX = resizeStartX - event.clientX;
      const deltaY = event.clientY - resizeStartY;
      const nextSize = applyPanelSize(resizeStartWidth + deltaX, resizeStartHeight + deltaY);
      const targetLeft = resizeAnchorRight - nextSize.width;
      const clampedPosition = applyPanelPosition(targetLeft, lastKnownPosition.top);
      lastKnownPosition = clampedPosition;
      return;
    }
    if (!isDragging) {
      return;
    }
    event.preventDefault();
    currentX = event.clientX - initialX;
    currentY = event.clientY - initialY;
    const maxX = Math.max(PANEL_MARGIN, window.innerWidth - panel.offsetWidth - PANEL_MARGIN);
    const maxY = Math.max(PANEL_MARGIN, window.innerHeight - panel.offsetHeight - PANEL_MARGIN);
    currentX = clamp(currentX, PANEL_MARGIN, maxX);
    currentY = clamp(currentY, PANEL_MARGIN, maxY);
    panel.style.left = `${currentX}px`;
    panel.style.top = `${currentY}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.transform = 'translate3d(0, 0, 0)';
    lastKnownPosition = { left: currentX, top: currentY };
  };

  const handleDocumentMouseUp = () => {
    let shouldRestoreSelection = false;
    if (isDragging) {
      isDragging = false;
      panel.style.transition = '';
      panel.style.removeProperty('transform');
      if (header) {
        header.style.cursor = 'move';
      }
      safeStorageSet({
        [POSITION_KEY]: lastKnownPosition
      }, 'panel position');
      shouldRestoreSelection = true;
    }
    if (isResizing) {
      isResizing = false;
      panel.classList.remove('is-resizing');
      panel.style.transition = '';
      const clampedPosition = applyPanelPosition(lastKnownPosition.left, lastKnownPosition.top);
      lastKnownPosition = clampedPosition;
      safeStorageSet({
        [SIZE_KEY]: panelState.lastKnownSize,
        [POSITION_KEY]: lastKnownPosition
      }, 'panel geometry');
      shouldRestoreSelection = true;
    }
    if (shouldRestoreSelection) {
      document.body.style.userSelect = '';
      window.requestAnimationFrame(() => {
        if (!panel || !panel.isConnected) {
          return;
        }
        const hovering = panel.matches(':hover');
        panelState.pointerInside = hovering;
        if (hovering) {
          panel.classList.add('is-hovering');
          panel.classList.remove('is-leaving');
          cancelEdgeHide({ show: true });
        } else {
          panel.classList.remove('is-hovering');
          panel.classList.add('is-leaving');
          scheduleEdgeHide();
        }
      });
    }
  };

  document.addEventListener('mousemove', handleDocumentMouseMove);
  document.addEventListener('mouseup', handleDocumentMouseUp);

  const handleWindowResize = () => {
    if (!panel || !panel.isConnected) {
      return;
    }
    const sourceWidth = panelState.lastKnownSize?.width ?? panel.offsetWidth;
    const sourceHeight = panelState.lastKnownSize?.height ?? panel.offsetHeight;
    applyPanelSize(sourceWidth, sourceHeight);
    const clampedPosition = applyPanelPosition(lastKnownPosition.left, lastKnownPosition.top);
    lastKnownPosition = clampedPosition;
    safeStorageSet({
      [SIZE_KEY]: panelState.lastKnownSize,
      [POSITION_KEY]: lastKnownPosition
    }, 'panel geometry');
  };

  window.addEventListener('resize', handleWindowResize);
  panelState.detachWindowResize = () => {
    window.removeEventListener('resize', handleWindowResize);
  };

  const destroy = () => {
    panel.removeEventListener('animationend', handlePanelIntroEnd);
    panel.removeEventListener('pointerenter', handlePointerEnter);
    panel.removeEventListener('pointermove', updatePointerPosition);
    panel.removeEventListener('pointerdown', updatePointerPosition);
    panel.removeEventListener('pointerup', updatePointerPosition);
    panel.removeEventListener('pointerleave', handlePointerLeave);
    panel.removeEventListener('focusin', handleFocusIn);
    panel.removeEventListener('focusout', handleFocusOut);
    if (header) {
      header.removeEventListener('mousedown', startDrag);
    }
    if (panelDom.resizeHandle) {
      panelDom.resizeHandle.removeEventListener('mousedown', startResize);
    }
    document.removeEventListener('mousemove', handleDocumentMouseMove);
    document.removeEventListener('mouseup', handleDocumentMouseUp);
    if (panelState.detachWindowResize) {
      panelState.detachWindowResize();
      panelState.detachWindowResize = null;
    }
    if (panelState.edgeTransitionUnbind) {
      panelState.edgeTransitionUnbind();
      panelState.edgeTransitionUnbind = null;
    }
    if (panelState.edgeAnimationTimer) {
      clearTimeout(panelState.edgeAnimationTimer);
      panelState.edgeAnimationTimer = null;
    }
    if (panelState.hideTimer) {
      clearTimeout(panelState.hideTimer);
      panelState.hideTimer = null;
    }
    if (panelState.documentPointerDownBound) {
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
      panelState.documentPointerDownBound = false;
    }
    panelState.scheduleEdgeHide = null;
    panelState.cancelEdgeHide = null;
    panelState.applyEdgeHiddenPosition = null;
    panelState.hidePanelToEdge = null;
    panelState.showPanelFromEdge = null;
    panelState.beginEdgeAnimation = null;
    panelState.lastKnownSize = null;
    vueApp.unmount();
    if (host.isConnected) {
      host.remove();
    }
  };

  return {
    panel,
    applyPanelSize,
    applyPanelPosition,
    getPanelBounds,
    syncPanelLayout,
    lastKnownPosition,
    scheduleEdgeHide,
    cancelEdgeHide,
    isPointerLikelyInsidePanel,
    updatePointerPosition,
    applyEdgeHiddenPosition,
    destroy
  };
}
