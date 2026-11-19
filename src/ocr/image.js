// Canvas-based image preprocessing for label OCR. Pure browser APIs, no external services.

export async function loadBitmap(source) {
  return createImageBitmap(source, { imageOrientation: 'from-image' });
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** Draws a region of `source` rotated by `angle` (0/90/180/270) and scaled by `scale`. */
export function renderRegion(source, { x = 0, y = 0, width = source.width, height = source.height, scale = 1, angle = 0 } = {}) {
  const swap = angle === 90 || angle === 270;
  const outW = (swap ? height : width) * scale;
  const outH = (swap ? width : height) * scale;
  const canvas = makeCanvas(outW, outH);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.drawImage(source, x, y, width, height, (-width * scale) / 2, (-height * scale) / 2, width * scale, height * scale);
  return canvas;
}

/** Converts to grayscale with percentile contrast stretch; optional inversion and Otsu binarization. */
/**
 * binarize: false | true (global Otsu) | 'adaptive' (Sauvola, robust to uneven lighting).
 * channel: 'luma' (default), 'red' or 'green'. The red channel turns red/pink pen marks and stamps into
 * background while black print and blue plates stay dark.
 */
export function toneCanvas(canvas, { invert = false, binarize = false, channel = 'luma' } = {}) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  const gray = new Uint8ClampedArray(px.length / 4);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = channel === 'red' ? px[i] : channel === 'green' ? px[i + 1] : Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    gray[j] = g;
    hist[g]++;
  }
  const [lo, hi] = percentiles(hist, gray.length, 0.01, 0.99);
  const range = Math.max(1, hi - lo);
  const stretched = new Uint8ClampedArray(gray.length);
  const hist2 = new Uint32Array(256);
  for (let j = 0; j < gray.length; j++) {
    let v = ((gray[j] - lo) * 255) / range;
    if (invert) v = 255 - v;
    stretched[j] = v;
    hist2[stretched[j]]++;
  }
  const local = binarize === 'adaptive' ? sauvola(stretched, canvas.width, canvas.height) : null;
  const threshold = binarize && !local ? otsu(hist2, stretched.length) : -1;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const v = local ? local[j] : threshold < 0 ? stretched[j] : stretched[j] > threshold ? 255 : 0;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  const out = makeCanvas(canvas.width, canvas.height);
  out.getContext('2d').putImageData(image, 0, 0);
  return out;
}

function percentiles(hist, total, lowShare, highShare) {
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * lowShare) { lo = v; break; } }
  acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * highShare) { hi = v; break; } }
  return [lo, hi];
}

function otsu(hist, total) {
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0, wB = 0, best = 0, threshold = 127;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += v * hist[v];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = v; }
  }
  return threshold;
}

/**
 * Renders a window of `source` in a frame rotated by `angle` (radians) around (cx, cy).
 * Window bounds are offsets from the centre along the rotated axes, in source pixels.
 */
export function renderRotatedWindow(source, { cx, cy, angle, left, right, top, bottom, scale = 1 }) {
  const canvas = makeCanvas((right - left) * scale, (bottom - top) * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(scale, scale);
  ctx.translate(-left, -top);
  ctx.rotate(-angle);
  ctx.translate(-cx, -cy);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

/**
 * Bounding boxes of 4-connected dark regions of a toned (binarized) canvas, left to right.
 * @returns {{x0:number,y0:number,x1:number,y1:number,touchesBorder:boolean}[]}
 */
export function darkComponents(canvas) {
  const { width, height } = canvas;
  const px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const dark = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < dark.length; i += 4, j++) dark[j] = px[i] < 128 ? 1 : 0;
  const stack = new Int32Array(dark.length);
  const boxes = [];
  for (let start = 0; start < dark.length; start++) {
    if (dark[start] !== 1) continue;
    let top = 0, x0 = width, y0 = height, x1 = -1, y1 = -1;
    stack[top++] = start;
    dark[start] = 2;
    while (top) {
      const p = stack[--top];
      const x = p % width, y = (p - x) / width;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && dark[p - 1] === 1) { dark[p - 1] = 2; stack[top++] = p - 1; }
      if (x < width - 1 && dark[p + 1] === 1) { dark[p + 1] = 2; stack[top++] = p + 1; }
      if (y > 0 && dark[p - width] === 1) { dark[p - width] = 2; stack[top++] = p - width; }
      if (y < height - 1 && dark[p + width] === 1) { dark[p + width] = 2; stack[top++] = p + width; }
    }
    boxes.push({ x0, y0, x1, y1, touchesBorder: x0 === 0 || y0 === 0 || x1 === width - 1 || y1 === height - 1 });
  }
  return boxes.sort((a, b) => a.x0 - b.x0);
}

const SAUVOLA_K = 0.2;
const SAUVOLA_R = 128;

/** Sauvola local thresholding using integral images; window ≈ 1/12 of the shorter side. */
function sauvola(gray, width, height) {
  const radius = Math.max(8, Math.round(Math.min(width, height) / 12));
  const w1 = width + 1;
  const sum = new Float64Array(w1 * (height + 1));
  const sq = new Float64Array(w1 * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0, rowSq = 0;
    for (let x = 0; x < width; x++) {
      const v = gray[y * width + x];
      rowSum += v; rowSq += v * v;
      sum[(y + 1) * w1 + x + 1] = sum[y * w1 + x + 1] + rowSum;
      sq[(y + 1) * w1 + x + 1] = sq[y * w1 + x + 1] + rowSq;
    }
  }
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1);
      const n = (x1 - x0) * (y1 - y0);
      const s = sum[y1 * w1 + x1] - sum[y0 * w1 + x1] - sum[y1 * w1 + x0] + sum[y0 * w1 + x0];
      const s2 = sq[y1 * w1 + x1] - sq[y0 * w1 + x1] - sq[y1 * w1 + x0] + sq[y0 * w1 + x0];
      const mean = s / n;
      const std = Math.sqrt(Math.max(0, s2 / n - mean * mean));
      out[y * width + x] = gray[y * width + x] > mean * (1 + SAUVOLA_K * (std / SAUVOLA_R - 1)) ? 255 : 0;
    }
  }
  return out;
}

