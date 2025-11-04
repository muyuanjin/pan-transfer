const STYLE_ID = 'zi-preview-style';
const EPS = 1e-6;
let installed = false;

interface PointerPosition {
  x: number;
  y: number;
}

interface DragStartState extends PointerPosition {
  sx: number;
  sy: number;
}

interface PinchStartState {
  dist: number;
  scale: number;
  mid: PointerPosition;
}

interface ZoomState {
  vw: number;
  vh: number;
  iw: number;
  ih: number;
  minScale: number;
  maxScale: number;
  scale: number;
  x: number;
  y: number;
  pointers: Map<number, PointerPosition>;
  dragging: boolean;
  pinch: boolean;
  dragStart: DragStartState | null;
  pinchStart: PinchStartState | null;
  moved: boolean;
  alive: boolean;
}

interface ZoomPreviewOptions {
  src?: string;
  alt?: string;
  maxScale?: number;
  margin?: number;
}

declare global {
  interface Window {
    openZoomPreview?: (options?: ZoomPreviewOptions) => { close: () => void } | null;
  }
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const css = [
    '.zi-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.84); z-index: 2147483647; display: flex; align-items: center; justify-content: center; }',
    '.zi-stage { position: relative; width: 100%; height: 100%; touch-action: none; display: flex; align-items: center; justify-content: center; user-select: none; }',
    '.zi-content { position: absolute; left: 50%; top: 50%; will-change: transform; transform-origin: center center; transform: translate3d(-50%, -50%, 0) scale(1); }',
    '.zi-content img { display: block; max-width: none !important; max-height: none !important; user-select: none; pointer-events: none; -webkit-user-drag: none; }',
    '.zi-close { position: absolute; top: 16px; right: 16px; width: 36px; height: 36px; border: 0; border-radius: 18px; background: rgba(0,0,0,.4); color: #fff; font-size: 20px; cursor: pointer; }',
    '.zi-spinner { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #fff9; font-size: 14px; }',
    '.zi-hidden { display: none !important; }'
  ].join(' ');
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function openZoomPreview(opts: ZoomPreviewOptions = {}): { close: () => void } | null {
  const src = opts.src || '';
  if (!src) {
    return null;
  }
  const alt = opts.alt || '';
  const maxScaleInput = Number.isFinite(opts.maxScale) ? Number(opts.maxScale) : 8;
  const margin = Number.isFinite(opts.margin) ? Number(opts.margin) : 64;

  injectStyles();

  const overlay = document.createElement('div');
  overlay.className = 'zi-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const stage = document.createElement('div');
  stage.className = 'zi-stage';

  const content = document.createElement('div');
  content.className = 'zi-content';

  const img = document.createElement('img');
  img.alt = alt;
  img.draggable = false;
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.src = src;

  const spinner = document.createElement('div');
  spinner.className = 'zi-spinner';
  spinner.textContent = '加载中…';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'zi-close';
  closeBtn.textContent = '✕';

  content.appendChild(img);
  stage.appendChild(content);
  stage.appendChild(spinner);
  stage.appendChild(closeBtn);
  overlay.appendChild(stage);
  document.body.appendChild(overlay);
  overlay.addEventListener('dragstart', event => {
    event.preventDefault();
  });

  const state: ZoomState = {
    vw: window.innerWidth,
    vh: window.innerHeight,
    iw: 0,
    ih: 0,
    minScale: 1,
    maxScale: maxScaleInput,
    scale: 1,
    x: 0,
    y: 0,
    pointers: new Map<number, PointerPosition>(),
    dragging: false,
    pinch: false,
    dragStart: null,
    pinchStart: null,
    moved: false,
    alive: true
  };

  function applyTransform(): void {
    clampPan();
    content.style.transform = `translate3d(-50%, -50%, 0) translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale})`;
  }

  function overflow(): { ox: number; oy: number } {
    const availW = Math.max(0, state.vw - margin * 2);
    const availH = Math.max(0, state.vh - margin * 2);
    const cw = state.iw * state.scale;
    const ch = state.ih * state.scale;
    return {
      ox: Math.max(0, (cw - availW) / 2),
      oy: Math.max(0, (ch - availH) / 2)
    };
  }

  function clampPan(): void {
    const { ox, oy } = overflow();
    state.x = ox === 0 ? 0 : clamp(state.x, -ox, ox);
    state.y = oy === 0 ? 0 : clamp(state.y, -oy, oy);
  }

  function fitAndInit(): void {
    if (!state.alive) {
      return;
    }
    state.vw = window.innerWidth;
    state.vh = window.innerHeight;

    const availW = Math.max(0, state.vw - margin * 2);
    const availH = Math.max(0, state.vh - margin * 2);

    const scaleToFit = Math.min(availW / state.iw, availH / state.ih);
    state.minScale = Math.min(1, isFinite(scaleToFit) ? scaleToFit : 1);
    state.scale = state.minScale;
    state.x = 0;
    state.y = 0;

    applyTransform();
  }

  function updatePointer(event: PointerEvent): void {
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  function removePointer(event: PointerEvent): void {
    state.pointers.delete(event.pointerId);
  }

  function twoPoints(): [PointerPosition, PointerPosition] | null {
    const entries = [...state.pointers.values()];
    return entries.length >= 2 ? entries.slice(0, 2) as [PointerPosition, PointerPosition] : null;
  }

  function dist(a: PointerPosition, b: PointerPosition): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function mid(a: PointerPosition, b: PointerPosition): PointerPosition {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function setScale(next: number, pivot?: PointerPosition): void {
    const prev = state.scale;
    const clamped = clamp(next, state.minScale, state.maxScale);
    const changed = Math.abs(clamped - prev) > EPS;

    if (changed) {
      const cx = state.vw / 2;
      const cy = state.vh / 2;
      const px = (pivot?.x ?? cx) - cx;
      const py = (pivot?.y ?? cy) - cy;
      const ratio = clamped / prev;
      state.x = ratio * state.x + (1 - ratio) * px;
      state.y = ratio * state.y + (1 - ratio) * py;
      state.scale = clamped;
    } else {
      state.scale = clamped;
    }

    applyTransform();
  }

  function wheelToScale(event: WheelEvent): void {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : (event.deltaMode === 2 ? window.innerHeight : 1);
    const delta = event.deltaY * unit;
    const factor = Math.exp(-delta * (event.ctrlKey ? 0.004 : 0.0022));
    setScale(state.scale * factor, { x: event.clientX, y: event.clientY });
  }

  function onPointerDown(event: PointerEvent): void {
    if (!state.alive) {
      return;
    }
    event.preventDefault();
    stage.setPointerCapture?.(event.pointerId);
    updatePointer(event);
    state.moved = false;

    if (state.pointers.size === 1) {
      state.dragging = true;
      state.dragStart = { x: event.clientX, y: event.clientY, sx: state.x, sy: state.y };
    } else if (state.pointers.size === 2) {
      state.dragging = false;
      const points = twoPoints();
      if (!points) {
        return;
      }
      const [a, b] = points;
      state.pinch = true;
      state.pinchStart = {
        dist: dist(a, b),
        scale: state.scale,
        mid: mid(a, b)
      };
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (!state.alive) {
      return;
    }
    updatePointer(event);

    if (state.pinch && state.pointers.size >= 2) {
      const points = twoPoints();
      const pinchState = state.pinchStart;
      if (!points || !pinchState) {
        return;
      }
      const [a, b] = points;
      const distance = Math.max(1, dist(a, b));
      const ratio = distance / Math.max(1, pinchState.dist);
      const nextScale = pinchState.scale * ratio;
      setScale(nextScale, pinchState.mid);
      state.moved = true;
      return;
    }

    if (state.dragging && state.pointers.size === 1 && state.dragStart) {
      const dx = event.clientX - state.dragStart.x;
      const dy = event.clientY - state.dragStart.y;
      state.x = state.dragStart.sx + dx;
      state.y = state.dragStart.sy + dy;
      state.moved = state.moved || Math.abs(dx) + Math.abs(dy) > 2;
      applyTransform();
    }
  }

  function onPointerUp(event: PointerEvent): void {
    const isCancel = event.type === 'pointercancel';
    removePointer(event);
    if (state.pinch && state.pointers.size < 2) {
      state.pinch = false;
      state.pinchStart = null;
    }
    if (state.dragging && state.pointers.size === 0) {
      state.dragging = false;
      state.dragStart = null;
    }
    if (!state.alive || isCancel) {
      return;
    }
    if (state.pointers.size === 0 && !state.dragging && !state.pinch && !state.moved) {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      close();
    }
  }

  function onResize(): void {
    if (!state.alive || !state.iw || !state.ih) {
      return;
    }
    const previousMin = state.minScale;
    fitAndInit();
    const ratio = previousMin > 0 ? state.scale / previousMin : 1;
    setScale(state.minScale * Math.max(1, ratio));
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      close();
    }
  }

  function onOverlayClick(event: MouseEvent): void {
    if (!state.alive) {
      return;
    }
    if (event.target !== overlay) {
      return;
    }
    if (!state.moved) {
      close();
    }
  }

  function close(): void {
    if (!state.alive) {
      return;
    }
    state.alive = false;
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKeydown, true);
    stage.removeEventListener('wheel', wheelHandler);
    stage.removeEventListener('pointerdown', onPointerDown);
    stage.removeEventListener('pointermove', onPointerMove);
    stage.removeEventListener('pointerup', onPointerUp);
    stage.removeEventListener('pointercancel', onPointerUp);
    overlay.removeEventListener('click', onOverlayClick);
    overlay.remove();
  }

  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeydown, true);
  const wheelHandler = (event: WheelEvent) => wheelToScale(event);
  stage.addEventListener('wheel', wheelHandler, false);
  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  overlay.addEventListener('click', onOverlayClick);
  closeBtn.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation();
    close();
  });

  function initOnLoad(): void {
    spinner.classList.add('zi-hidden');
    state.iw = img.naturalWidth || img.width || 1;
    state.ih = img.naturalHeight || img.height || 1;
    fitAndInit();
  }

  if (img.complete && (img.naturalWidth || img.width)) {
    initOnLoad();
  } else {
    img.addEventListener('load', initOnLoad, { once: true });
    img.addEventListener('error', () => {
      spinner.textContent = '加载失败';
    }, { once: true });
  }

  return { close };
}

export function installZoomPreview() {
  if (installed) {
    return;
  }
  if (typeof window !== 'undefined') {
    if (!window.openZoomPreview) {
      window.openZoomPreview = openZoomPreview;
    }
  }
  installed = true;
}
