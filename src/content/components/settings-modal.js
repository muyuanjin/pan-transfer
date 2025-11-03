import {
  STORAGE_KEY,
  HISTORY_KEY,
  CACHE_KEY,
  POSITION_KEY,
  SIZE_KEY,
  DEFAULT_PRESETS,
  SETTINGS_EXPORT_VERSION,
  DATA_EXPORT_VERSION,
  HISTORY_BATCH_RATE_LIMIT_MS,
  MIN_HISTORY_RATE_LIMIT_MS,
  MAX_HISTORY_RATE_LIMIT_MS
} from '../constants.js';
import { panelDom, state } from '../state/index.js';
import { normalizeDir } from '../services/page-analyzer.js';

export function clampHistoryRateLimit(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) {
    return HISTORY_BATCH_RATE_LIMIT_MS;
  }
  const clamped = Math.round(ms);
  return Math.min(
    MAX_HISTORY_RATE_LIMIT_MS,
    Math.max(MIN_HISTORY_RATE_LIMIT_MS, clamped)
  );
}

export function sanitizePreset(value) {
  if (!value) {
    return '';
  }
  let sanitized = value.trim();
  sanitized = sanitized.replace(/\s+/g, ' ');
  if (!sanitized.startsWith('/')) {
    sanitized = `/${sanitized}`;
  }
  sanitized = sanitized.replace(/\/+/g, '/');
  if (sanitized.length > 1 && sanitized.endsWith('/')) {
    sanitized = sanitized.slice(0, -1);
  }
  return sanitized;
}

function buildSettingsSnapshot() {
  return {
    baseDir: state.baseDir,
    useTitleSubdir: state.useTitleSubdir,
    useSeasonSubdir: state.useSeasonSubdir,
    presets: [...state.presets],
    theme: state.theme,
    historyRateLimitMs: clampHistoryRateLimit(state.historyRateLimitMs)
  };
}

function formatExportFilename(prefix) {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}-${datePart}-${timePart}.json`;
}

function downloadJsonFile(documentRef, filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = documentRef.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  documentRef.body.appendChild(anchor);
  anchor.click();
  requestAnimationFrame(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsText(file, 'utf-8');
  });
}

function resetFileInput(input) {
  if (input) {
    input.value = '';
  }
}

function extractSettingsFormValues({ strict = false } = {}) {
  if (!panelDom.settingsBaseDir) {
    return null;
  }
  const rawBase = panelDom.settingsBaseDir.value || '';
  const sanitizedBase = normalizeDir(rawBase);
  const useTitle = panelDom.settingsUseTitle ? panelDom.settingsUseTitle.checked : state.useTitleSubdir;
  const useSeason = panelDom.settingsUseSeason ? panelDom.settingsUseSeason.checked : state.useSeasonSubdir;
  const themeValue = panelDom.settingsTheme && panelDom.settingsTheme.value === 'light' ? 'light' : 'dark';
  const presetsText = panelDom.settingsPresets ? panelDom.settingsPresets.value : '';
  const presetList = presetsText
    .split(/\n+/)
    .map(item => sanitizePreset(item))
    .filter(Boolean);
  const rateInput = panelDom.settingsHistoryRate ? parseFloat(panelDom.settingsHistoryRate.value) : Number.NaN;
  const seconds = Number.isFinite(rateInput) ? rateInput : state.historyRateLimitMs / 1000;
  if (strict && (seconds < 0.5 || seconds > 60)) {
    throw new Error('历史批量检测间隔需在 0.5～60 秒之间');
  }
  const rateMs = clampHistoryRateLimit(Math.round(seconds * 1000));
  return {
    baseDir: sanitizedBase,
    useTitleSubdir: useTitle,
    useSeasonSubdir: useSeason,
    theme: themeValue,
    presets: presetList,
    historyRateLimitMs: rateMs
  };
}

export function createSettingsModal({
  document,
  floatingPanel,
  panelState,
  scheduleEdgeHide,
  cancelEdgeHide,
  showToast,
  setBaseDir,
  renderSeasonHint,
  renderResourceList,
  applyPanelTheme,
  saveSettings,
  safeStorageSet,
  safeStorageRemove,
  loadSettings,
  loadHistory,
  closeHistoryDetail,
  onResetLayout
}) {
  function renderSettingsPanel() {
    if (!panelDom.settingsOverlay) {
      return;
    }
    if (panelDom.settingsBaseDir) {
      panelDom.settingsBaseDir.value = state.baseDir || '/';
      panelDom.settingsBaseDir.classList.remove('is-invalid');
    }
    if (panelDom.settingsUseTitle) {
      panelDom.settingsUseTitle.checked = state.useTitleSubdir;
    }
    if (panelDom.settingsUseSeason) {
      panelDom.settingsUseSeason.checked = state.useSeasonSubdir;
    }
    if (panelDom.settingsTheme) {
      panelDom.settingsTheme.value = state.theme === 'light' ? 'light' : 'dark';
    }
    if (panelDom.settingsPresets) {
      panelDom.settingsPresets.value = state.presets.join('\n');
    }
    if (panelDom.settingsHistoryRate) {
      const seconds = state.historyRateLimitMs / 1000;
      panelDom.settingsHistoryRate.value = (Math.round(seconds * 100) / 100).toFixed(2);
      panelDom.settingsHistoryRate.classList.remove('is-invalid');
    }
  }

  function applySettingsUpdate(nextSettings = {}, { persist = true } = {}) {
    if (!nextSettings || typeof nextSettings !== 'object') {
      throw new Error('无效设置对象');
    }
    const baseDir = typeof nextSettings.baseDir === 'string'
      ? normalizeDir(nextSettings.baseDir)
      : state.baseDir;
    const useTitle = typeof nextSettings.useTitleSubdir === 'boolean'
      ? nextSettings.useTitleSubdir
      : state.useTitleSubdir;
    const hasSeasonPref = typeof nextSettings.useSeasonSubdir === 'boolean';
    const useSeason = hasSeasonPref ? Boolean(nextSettings.useSeasonSubdir) : state.useSeasonSubdir;
    const theme = nextSettings.theme === 'light' || nextSettings.theme === 'dark'
      ? nextSettings.theme
      : state.theme;
    const rateMs = typeof nextSettings.historyRateLimitMs === 'number'
      ? clampHistoryRateLimit(nextSettings.historyRateLimitMs)
      : clampHistoryRateLimit(state.historyRateLimitMs);
    const sourcePresets = Array.isArray(nextSettings.presets)
      ? nextSettings.presets
      : state.presets;
    const sanitizedPresets = Array.from(new Set([
      ...DEFAULT_PRESETS,
      ...sourcePresets.map(item => sanitizePreset(item)).filter(Boolean)
    ]));

    state.presets = sanitizedPresets;
    state.useTitleSubdir = useTitle;
    state.historyRateLimitMs = rateMs;
    if (hasSeasonPref) {
      state.useSeasonSubdir = useSeason;
      state.hasSeasonSubdirPreference = true;
    }
    const previousTheme = state.theme;
    state.theme = theme;

    setBaseDir(baseDir, { persist: false });
    if (panelDom.useTitleCheckbox) {
      panelDom.useTitleCheckbox.checked = state.useTitleSubdir;
    }
    if (panelDom.useSeasonCheckbox) {
      panelDom.useSeasonCheckbox.checked = state.useSeasonSubdir;
    }
    if (floatingPanel) {
      renderSeasonHint();
      renderResourceList();
    }
    applyPanelTheme();
    if (persist) {
      saveSettings();
    }
    if (state.settingsPanel.isOpen) {
      renderSettingsPanel();
    }
    return {
      ...buildSettingsSnapshot(),
      themeChanged: previousTheme !== state.theme
    };
  }

  async function exportSettingsSnapshot() {
    try {
      const payload = {
        type: 'chaospace-settings-export',
        version: SETTINGS_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        settings: buildSettingsSnapshot()
      };
      downloadJsonFile(document, formatExportFilename('chaospace-settings'), payload);
      showToast('success', '设置已导出', 'JSON 文件可用于快速迁移参数');
    } catch (error) {
      console.error('[Chaospace Transfer] Failed to export settings', error);
      showToast('error', '导出失败', error.message || '无法导出设置');
    }
  }

  async function exportFullBackup() {
    try {
      const keys = [STORAGE_KEY, HISTORY_KEY, CACHE_KEY, POSITION_KEY, SIZE_KEY];
      const stored = await chrome.storage.local.get(keys);
      const payload = {
        type: 'chaospace-transfer-backup',
        version: DATA_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        data: {
          settings: buildSettingsSnapshot(),
          history: stored[HISTORY_KEY] || null,
          cache: stored[CACHE_KEY] || null,
          panel: {
            position: stored[POSITION_KEY] || null,
            size: stored[SIZE_KEY] || null
          }
        }
      };
      downloadJsonFile(document, formatExportFilename('chaospace-backup'), payload);
      showToast('success', '插件数据已导出', '备份包含设置、历史、缓存与面板布局');
    } catch (error) {
      console.error('[Chaospace Transfer] Failed to export backup', error);
      showToast('error', '导出失败', error.message || '无法导出插件数据');
    }
  }

  async function importSettingsSnapshot(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('文件内容不合法');
    }
    const source = payload.settings && typeof payload.settings === 'object'
      ? payload.settings
      : payload;
    applySettingsUpdate(source, { persist: true });
    showToast('success', '设置已导入', '已更新所有可配置参数');
  }

  async function importFullBackup(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('文件内容不合法');
    }
    const source = payload.data && typeof payload.data === 'object'
      ? payload.data
      : payload;
    const entries = {};
    const removals = [];
    if ('settings' in source) {
      if (source.settings && typeof source.settings === 'object') {
        entries[STORAGE_KEY] = source.settings;
      } else {
        removals.push(STORAGE_KEY);
      }
    }
    if ('history' in source) {
      if (source.history) {
        entries[HISTORY_KEY] = source.history;
      } else {
        removals.push(HISTORY_KEY);
      }
    }
    if ('cache' in source) {
      if (source.cache) {
        entries[CACHE_KEY] = source.cache;
      } else {
        removals.push(CACHE_KEY);
      }
    }
    const panelData = source.panel && typeof source.panel === 'object' ? source.panel : {};
    if ('position' in panelData) {
      if (panelData.position) {
        entries[POSITION_KEY] = panelData.position;
      } else {
        removals.push(POSITION_KEY);
      }
    }
    if ('size' in panelData) {
      if (panelData.size) {
        entries[SIZE_KEY] = panelData.size;
      } else {
        removals.push(SIZE_KEY);
      }
    }

    if (Object.keys(entries).length) {
      await safeStorageSet(entries, 'data import');
    }
    if (removals.length) {
      await safeStorageRemove(removals, 'data import cleanup');
    }

    await loadSettings();
    applySettingsUpdate(buildSettingsSnapshot(), { persist: false });
    await loadHistory();
    state.historyDetailCache = new Map();
    closeHistoryDetail({ hideDelay: 0 });
    showToast('success', '数据已导入', '备份内容已写入，历史记录与缓存已更新');
  }

  const handleSettingsKeydown = (event) => {
    if (event.key === 'Escape') {
      closeSettingsPanel({ restoreFocus: true });
      event.stopPropagation();
    }
  };

  function openSettingsPanel() {
    if (!panelDom.settingsOverlay) {
      return;
    }
    if (state.settingsPanel.isOpen) {
      renderSettingsPanel();
      const focusTarget = panelDom.settingsBaseDir || panelDom.settingsHistoryRate || panelDom.settingsTheme;
      focusTarget?.focus?.({ preventScroll: true });
      return;
    }
    state.settingsPanel.isOpen = true;
    panelDom.settingsOverlay.classList.add('is-open');
    panelDom.settingsOverlay.setAttribute('aria-hidden', 'false');
    panelDom.settingsToggle?.setAttribute('aria-expanded', 'true');
    floatingPanel?.classList.add('is-settings-open');
    renderSettingsPanel();
    const focusTarget = panelDom.settingsBaseDir || panelDom.settingsHistoryRate || panelDom.settingsTheme;
    focusTarget?.focus?.({ preventScroll: true });
    panelState.pointerInside = true;
    cancelEdgeHide?.({ show: true });
    document.addEventListener('keydown', handleSettingsKeydown, true);
  }

  function closeSettingsPanel({ restoreFocus = false } = {}) {
    if (!state.settingsPanel.isOpen) {
      return;
    }
    state.settingsPanel.isOpen = false;
    panelDom.settingsOverlay?.classList.remove('is-open');
    panelDom.settingsOverlay?.setAttribute('aria-hidden', 'true');
    panelDom.settingsToggle?.setAttribute('aria-expanded', 'false');
    floatingPanel?.classList.remove('is-settings-open');
    document.removeEventListener('keydown', handleSettingsKeydown, true);
    if (!panelState.isPinned) {
      scheduleEdgeHide?.();
    }
    if (restoreFocus) {
      panelDom.settingsToggle?.focus?.({ preventScroll: true });
    }
  }

  function attachEventListeners() {
    if (panelDom.settingsToggle) {
      panelDom.settingsToggle.addEventListener('click', () => {
        if (state.settingsPanel.isOpen) {
          closeSettingsPanel({ restoreFocus: true });
        } else {
          openSettingsPanel();
        }
      });
    }

    if (panelDom.settingsClose) {
      panelDom.settingsClose.addEventListener('click', () => {
        closeSettingsPanel({ restoreFocus: true });
      });
    }

    if (panelDom.settingsCancel) {
      panelDom.settingsCancel.addEventListener('click', () => {
        closeSettingsPanel({ restoreFocus: true });
      });
    }

    if (panelDom.settingsOverlay) {
      panelDom.settingsOverlay.addEventListener('click', (event) => {
        if (event.target === panelDom.settingsOverlay) {
          closeSettingsPanel({ restoreFocus: false });
        }
      });
    }

    if (panelDom.settingsForm) {
      panelDom.settingsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (panelDom.settingsHistoryRate) {
          panelDom.settingsHistoryRate.classList.remove('is-invalid');
        }
        try {
          const update = extractSettingsFormValues({ strict: true });
          if (!update) {
            closeSettingsPanel({ restoreFocus: true });
            return;
          }
          applySettingsUpdate(update, { persist: true });
          showToast('success', '设置已保存', '所有参数已更新并立即生效');
          closeSettingsPanel({ restoreFocus: true });
        } catch (error) {
          console.error('[Chaospace Transfer] Failed to save settings', error);
          if (panelDom.settingsHistoryRate && error && typeof error.message === 'string' && error.message.includes('间隔')) {
            panelDom.settingsHistoryRate.classList.add('is-invalid');
            panelDom.settingsHistoryRate.focus({ preventScroll: true });
          }
          showToast('error', '保存失败', error.message || '请检查输入是否正确');
        }
      });
    }

    if (panelDom.settingsExportConfig) {
      panelDom.settingsExportConfig.addEventListener('click', () => {
        exportSettingsSnapshot();
      });
    }

    if (panelDom.settingsExportData) {
      panelDom.settingsExportData.addEventListener('click', () => {
        exportFullBackup();
      });
    }

    if (panelDom.settingsImportConfigTrigger && panelDom.settingsImportConfigInput) {
      panelDom.settingsImportConfigTrigger.addEventListener('click', () => {
        panelDom.settingsImportConfigInput?.click();
      });
      panelDom.settingsImportConfigInput.addEventListener('change', async (event) => {
        const input = event.currentTarget;
        const file = input?.files && input.files[0];
        if (!file) {
          return;
        }
        try {
          const text = await readFileAsText(file);
          const parsed = JSON.parse(text);
          if (parsed.type && parsed.type !== 'chaospace-settings-export') {
            throw new Error('请选择通过“导出设置”生成的 JSON 文件');
          }
          await importSettingsSnapshot(parsed);
        } catch (error) {
          console.error('[Chaospace Transfer] Settings import failed', error);
          showToast('error', '导入失败', error.message || '无法导入设置文件');
        } finally {
          resetFileInput(panelDom.settingsImportConfigInput);
        }
      });
    }

    if (panelDom.settingsImportDataTrigger && panelDom.settingsImportDataInput) {
      panelDom.settingsImportDataTrigger.addEventListener('click', () => {
        panelDom.settingsImportDataInput?.click();
      });
      panelDom.settingsImportDataInput.addEventListener('change', async (event) => {
        const input = event.currentTarget;
        const file = input?.files && input.files[0];
        if (!file) {
          return;
        }
        try {
          const text = await readFileAsText(file);
          const parsed = JSON.parse(text);
          if (parsed.type && parsed.type !== 'chaospace-transfer-backup') {
            throw new Error('请选择通过“导出全部数据”生成的 JSON 文件');
          }
          await importFullBackup(parsed);
        } catch (error) {
          console.error('[Chaospace Transfer] Backup import failed', error);
          showToast('error', '导入失败', error.message || '无法导入数据备份');
        } finally {
          resetFileInput(panelDom.settingsImportDataInput);
        }
      });
    }

    if (panelDom.settingsResetLayout) {
      panelDom.settingsResetLayout.addEventListener('click', async () => {
        await onResetLayout();
      });
    }
  }

  attachEventListeners();
  renderSettingsPanel();

  return {
    render: renderSettingsPanel,
    open: openSettingsPanel,
    close: closeSettingsPanel,
    applySettingsUpdate,
    buildSettingsSnapshot
  };
}
