import { mountPanelShell as mountPanelShellImpl } from './panel-impl.js';
import type { PanelRuntimeState, PanelDomRefs } from '../types';

interface PanelShellConstants {
  EDGE_HIDE_DELAY: number;
  EDGE_HIDE_DEFAULT_PEEK: number;
  EDGE_HIDE_MIN_PEEK: number;
  EDGE_HIDE_MAX_PEEK: number;
}

interface PanelStorageKeys {
  POSITION_KEY: string;
  SIZE_KEY: string;
}

export interface MountPanelShellOptions {
  document: Document;
  window: Window;
  panelDom: PanelDomRefs;
  panelState: PanelRuntimeState;
  pageTitle: string;
  originLabel: string;
  theme: string;
  handleDocumentPointerDown: (event: PointerEvent) => void;
  constants: PanelShellConstants;
  storageKeys: PanelStorageKeys;
}

export interface MountedPanelShell {
  panel: HTMLElement;
  applyPanelSize: (width: number, height: number) => { width: number; height: number } | null;
  applyPanelPosition: (left: number, top: number) => { left: number; top: number };
  getPanelBounds: () => { minWidth: number; minHeight: number; maxWidth: number; maxHeight: number };
  syncPanelLayout: () => void;
  lastKnownPosition: { left: number; top: number };
  scheduleEdgeHide: (options?: { delay?: number; peek?: number }) => void;
  cancelEdgeHide: () => void;
  isPointerLikelyInsidePanel: () => boolean;
  updatePointerPosition: (event?: PointerEvent) => void;
  applyEdgeHiddenPosition: () => void;
  destroy: () => void;
}

export function mountPanelShell(options: MountPanelShellOptions): Promise<MountedPanelShell> {
  return mountPanelShellImpl(options) as Promise<MountedPanelShell>;
}
