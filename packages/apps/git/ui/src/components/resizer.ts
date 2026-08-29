export interface ResizerOptions {
  minWidth?: number;
  maxWidth?: number;
  defaultWidth?: number;
}

export function createResizer(
  leftEl: HTMLElement,
  storageKey: string,
  opts: ResizerOptions = {}
): HTMLElement {
  const minWidth = opts.minWidth ?? 180;
  const maxWidth = opts.maxWidth ?? 600;
  const defaultWidth = opts.defaultWidth ?? 300;

  // Restore width from localStorage if available
  const stored = localStorage.getItem(`ikenga.git.resizer.${storageKey}`);
  const initialWidth = stored ? Math.max(minWidth, Math.min(maxWidth, parseInt(stored, 10))) : defaultWidth;

  leftEl.style.width = `${initialWidth}px`;
  leftEl.style.flex = 'none';

  const resizer = document.createElement('div');
  resizer.className = 'git-resizer';
  resizer.title = 'Drag to resize pane';

  let startX = 0;
  let startWidth = 0;

  const onPointerMove = (e: PointerEvent) => {
    const dx = e.clientX - startX;
    const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + dx));
    leftEl.style.width = `${newWidth}px`;
  };

  const onPointerUp = (e: PointerEvent) => {
    resizer.classList.remove('git-resizer--active');
    document.body.style.removeProperty('user-select');
    document.body.style.removeProperty('cursor');
    try {
      resizer.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture release is not supported
    }

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);

    const finalWidth = parseInt(leftEl.style.width, 10);
    if (!isNaN(finalWidth)) {
      localStorage.setItem(`ikenga.git.resizer.${storageKey}`, String(finalWidth));
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    startX = e.clientX;
    startWidth = leftEl.getBoundingClientRect().width;
    resizer.classList.add('git-resizer--active');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    try {
      resizer.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if setPointerCapture fails
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  resizer.addEventListener('pointerdown', onPointerDown);

  return resizer;
}
