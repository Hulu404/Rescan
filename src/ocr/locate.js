// Locates the dark-blue model plate (white text on blue) that labels of this layout carry.
// Geometry is measured from the image itself (connected component + second moments),
// so position, scale and rotation are not tied to any particular photo.

const ANALYSIS_MAX_SIDE = 900;
const MIN_AREA_SHARE = 0.0015;
const MIN_ELONGATION = 2.2;
const MAX_ELONGATION = 9;
const MIN_FILL = 0.55;

// The plate is dark navy: on real photos B is 34–87 with R ≤ 20 and saturation ≥ 0.74, depending on exposure.
// So the test is blue dominance and saturation, not absolute brightness. Black print with a bluish
// cast (e.g. 20,25,40) fails the saturation and B−R margins.
const PLATE_MIN_BLUE = 30;
const PLATE_MIN_BLUE_OVER_RED = 25;
const PLATE_MIN_BLUE_OVER_GREEN = 15;
const PLATE_MIN_SATURATION = 0.55;
const PLATE_MAX_RED = 140;

function isPlateBlue(r, g, b) {
  return b >= PLATE_MIN_BLUE && b - r >= PLATE_MIN_BLUE_OVER_RED && b - g >= PLATE_MIN_BLUE_OVER_GREEN
    && b - Math.min(r, g) >= PLATE_MIN_SATURATION * b && r < PLATE_MAX_RED;
}

/**
 * @returns {null | {cx:number, cy:number, angle:number, length:number, thickness:number}}
 *   centre and size in source pixels, angle (radians) of the long axis.
 */
export function findModelPlate(source) {
  const scale = Math.min(1, ANALYSIS_MAX_SIDE / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, width, height);
  const px = ctx.getImageData(0, 0, width, height).data;

  const mask = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < mask.length; i += 4, j++) mask[j] = isPlateBlue(px[i], px[i + 1], px[i + 2]) ? 1 : 0;
  closeHoles(mask, width, height);

  const best = largestPlateComponent(mask, width, height);
  if (!best) return null;
  return { cx: best.cx / scale, cy: best.cy / scale, angle: best.angle, length: best.length / scale, thickness: best.thickness / scale };
}

// White letters punch holes into the blue mask; a horizontal+vertical dilation then erosion closes them.
function closeHoles(mask, width, height, radius = 3) {
  const dilated = morph(mask, width, height, radius, 1);
  const closed = morph(dilated, width, height, radius, 0);
  mask.set(closed);
}

function morph(mask, width, height, radius, value) {
  const pass = (input, horizontal) => {
    const out = new Uint8Array(input.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let hit = false;
      for (let d = -radius; d <= radius && !hit; d++) {
        const xx = horizontal ? x + d : x, yy = horizontal ? y : y + d;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        if (input[yy * width + xx] === value) hit = true;
      }
      out[y * width + x] = hit ? value : 1 - value;
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

function largestPlateComponent(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const members = new Int32Array(mask.length);
  const minArea = width * height * MIN_AREA_SHARE;
  let best = null;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 0, n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const p = stack[--top];
      members[n] = p;
      const x = p % width, y = (p - x) / width;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      for (const q of [p - 1, p + 1, p - width, p + width]) {
        if (q < 0 || q >= mask.length || seen[q] || !mask[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === width - 1)) continue;
        seen[q] = 1;
        stack[top++] = q;
      }
    }
    if (n < minArea) continue;
    const cx = sx / n, cy = sy / n;
    const mu20 = sxx / n - cx * cx, mu02 = syy / n - cy * cy, mu11 = sxy / n - cx * cy;
    const common = Math.sqrt(((mu20 - mu02) / 2) ** 2 + mu11 ** 2);
    const l1 = (mu20 + mu02) / 2 + common, l2 = (mu20 + mu02) / 2 - common;
    if (l2 <= 0) continue;
    // A filled rectangle of side a has variance a²/12 along that side.
    const length = Math.sqrt(12 * l1), thickness = Math.sqrt(12 * l2);
    const elongation = length / thickness, fill = n / (length * thickness);
    if (elongation < MIN_ELONGATION || elongation > MAX_ELONGATION || fill < MIN_FILL) continue;
    if (best && n <= best.n) continue;
    const angle = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);
    best = { n, angle, ...orientedExtent(members.subarray(0, n), width, cx, cy, angle) };
  }
  return best;
}

// Share of pixels trimmed at each end of the extent, so stray edge pixels do not widen the box.
const EXTENT_TRIM = 0.005;

/**
 * Plate box from the actual pixel extent along its axes. Moments alone overstate thickness:
 * white letters remove the middle of the plate and leave its mass at the top and bottom edges.
 */
function orientedExtent(pixels, width, cx, cy, angle) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const along = new Float32Array(pixels.length), across = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    const x = (pixels[i] % width) - cx, y = Math.floor(pixels[i] / width) - cy;
    along[i] = x * cos + y * sin;
    across[i] = -x * sin + y * cos;
  }
  const [a0, a1] = trimmedRange(along), [b0, b1] = trimmedRange(across);
  const midAlong = (a0 + a1) / 2, midAcross = (b0 + b1) / 2;
  return {
    cx: cx + midAlong * cos - midAcross * sin,
    cy: cy + midAlong * sin + midAcross * cos,
    length: a1 - a0 + 1,
    thickness: b1 - b0 + 1,
  };
}

function trimmedRange(values) {
  const sorted = values.slice().sort();
  const k = Math.floor(sorted.length * EXTENT_TRIM);
  return [sorted[k], sorted[sorted.length - 1 - k]];
}
