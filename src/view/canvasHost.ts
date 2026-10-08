// Canvas host: the ONLY place that touches devicePixelRatio and raw canvas
// sizing (PLAN I-02). Renderers always work in CSS pixels.

/** Arguments handed to the render callback. width/height are CSS pixels. */
export interface RenderArgs {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
}

export type RenderCallback = (args: RenderArgs) => void;

export interface CanvasHost {
  canvas: HTMLCanvasElement;
  /** Request a render; coalesced via requestAnimationFrame (D-10: on-demand only). */
  requestRender(): void;
  destroy(): void;
}

/**
 * Creates a full-window `<canvas>` attached to `document.body` and keeps its
 * backing store at CSS size × devicePixelRatio. Handles window resize and
 * DPR changes (e.g. dragging between monitors). Never renders on its own —
 * rendering happens only when `requestRender()` is called, at most once per
 * animation frame.
 */
export function createCanvasHost(render: RenderCallback): CanvasHost {
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  document.body.append(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  let rafPending = false;

  /** Sync the backing store with the current CSS size and DPR. */
  function syncSize(): void {
    const dpr = window.devicePixelRatio;
    // Viewport in CSS pixels; rounded so the backing store uses whole pixels.
    const cssW = Math.round(window.innerWidth);
    const cssH = Math.round(window.innerHeight);
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
  }

  function doRender(): void {
    rafPending = false;
    syncSize();
    const dpr = window.devicePixelRatio;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    // Draw in CSS pixels: the renderer never thinks about DPR (I-02).
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    render({ ctx: ctx!, width, height, dpr });
  }

  function requestRender(): void {
    if (rafPending) return; // coalesce multiple requests into one frame
    rafPending = true;
    requestAnimationFrame(doRender);
  }

  const onResize = () => requestRender();

  // DPR changes (moving between monitors, OS/browser zoom) fire the change
  // event of this resolution media query: it matches exactly while the CSS
  // device-pixel ratio equals the value captured when the query was created.
  let dprQuery: MediaQueryList;
  const onDprChange = () => {
    dprQuery.removeEventListener('change', onDprChange);
    requestRender();
    dprQuery = makeDprQuery();
    dprQuery.addEventListener('change', onDprChange);
  };
  const makeDprQuery = () =>
    window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);

  dprQuery = makeDprQuery();
  dprQuery.addEventListener('change', onDprChange);
  window.addEventListener('resize', onResize);

  return {
    canvas,
    requestRender,
    destroy() {
      dprQuery.removeEventListener('change', onDprChange);
      window.removeEventListener('resize', onResize);
      canvas.remove();
    },
  };
}
