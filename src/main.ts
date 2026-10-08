// VexBoard entry point: wires the canvas host to a minimal render callback.
// No camera, no document model yet (T-001 scope).
import './style.css';
import { createCanvasHost } from './view/canvasHost';

const BG = '#1e1e24';
const FG = '#e8e8ef';

const host = createCanvasHost(({ ctx, width, height }) => {
  // Solid background across the whole window (CSS pixels; DPR handled by host).
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = FG;
  ctx.font = '24px system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('VexBoard', 24, 40);
});

// Initial paint only — renders on demand, never in a continuous loop (D-10).
host.requestRender();
