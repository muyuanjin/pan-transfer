import {
  clampHistoryRateLimit as clampHistoryRateLimitImpl,
  sanitizePreset as sanitizePresetImpl,
  createSettingsModal as createSettingsModalImpl
} from './settings-modal-impl.js';
import type { PanelRuntimeState } from '../types';

declare global {
  interface Window {
    __chaospaceSettingsModal?: unknown;
  }
}

export function clampHistoryRateLimit(value: number): number {
  return clampHistoryRateLimitImpl(value) as number;
}

export function sanitizePreset(value: string): string {
  return sanitizePresetImpl(value) as string;
}

export interface CreateSettingsModalOptions {
  document: Document;
  floatingPanel: HTMLElement | null | undefined;
  panelState: PanelRuntimeState;
  scheduleEdgeHide: ((options?: { show?: boolean }) => void) | undefined;
  cancelEdgeHide: ((options?: { show?: boolean }) => void) | undefined;
  showToast: (type: string, title: string, message?: string, stats?: unknown) => void;
  setBaseDir: (value: string, options?: Record<string, unknown>) => void;
  renderSeasonHint: () => void;
  renderResourceList: () => void;
  applyPanelTheme: () => void;
  saveSettings: () => void;
  safeStorageSet: ((entries: Record<string, unknown>, contextLabel?: string) => Promise<void> | void) | undefined;
  safeStorageRemove: ((keys: string[] | string, contextLabel?: string) => Promise<void> | void) | undefined;
  loadSettings: (() => Promise<void> | void) | undefined;
  loadHistory: (() => Promise<void> | void) | undefined;
  closeHistoryDetail: ((options?: Record<string, unknown>) => void) | undefined;
  onResetLayout: (() => void) | undefined;
}

export interface SettingsModalHandles {
  render: () => void;
  open: () => void;
  close: (options?: { restoreFocus?: boolean }) => void;
  applySettingsUpdate: (nextSettings: Record<string, unknown>, options?: { persist?: boolean }) => void;
  buildSettingsSnapshot: () => Record<string, unknown>;
}

export function createSettingsModal(options: CreateSettingsModalOptions): SettingsModalHandles {
  return createSettingsModalImpl(options) as SettingsModalHandles;
}
