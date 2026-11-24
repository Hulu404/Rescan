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
 * The largest plate of the photo.
 * @returns {null | {cx:number, cy:number, angle:number, length:number, thickness:number}}
 *   centre and size in source pixels, angle (radians) of the long axis.
 */
export function findModelPlate(source) {
  return detectPlates(source).reduce((best, plate) => (!best || plate.area > best.area ? plate : best), null);
}

// In a guide-cropped photo the label fills the frame: its plate is about 0.3 of the frame width. Anything much
// shorter is other blue print (the "Alcon" logo is about 0.11) or a label too far away to read.
const MIN_FRAMED_LENGTH_SHARE = 0.15;
// Label centre relative to the plate centre, in plate lengths along and across the plate (measured on toric-01).
const LABEL_CENTRE = { along: 0.95, across: 0.31 };

// The label centre must be this close to the photo centre, as a share of the photo side; otherwise it is a neighbour.
const MAX_OFF_CENTRE = 0.25;

/**
 * The plate of the label in the middle of a guide-cropped photo. Plates cut by the border and labels lying
 * off-centre belong to neighbours and are never returned.
 * @returns {{plate: null | {cx:number, cy:number, angle:number, length:number, thickness:number}, found:number}}
 *   found: plates of readable size in the photo, including rejected ones
 */
export function findFramedPlate(source) {
  const plates = detectPlates(source).filter(p => p.length >= MIN_FRAMED_LENGTH_SHARE * source.width);
  const ranked = plates
    .filter(p => !p.touchesBorder)
    .map(plate => ({ plate, offset: labelOffset(plate, source) }))
    .filter(({ offset }) => offset <= MAX_OFF_CENTRE)
    .sort((a, b) => a.offset - b.offset);
  return { plate: ranked[0]?.plate ?? null, found: plates.length };
}

/** Label centre to photo centre as a share of the photo side; the label may be upside down, so the nearer reading counts. */
function labelOffset(plate, source) {
  const cos = Math.cos(plate.angle), sin = Math.sin(plate.angle);
  const along = LABEL_CENTRE.along * plate.length, across = LABEL_CENTRE.across * plate.length;
  const dx = along * cos - across * sin, dy = along * sin + across * cos;
  return Math.min(...[1, -1].map(side => Math.max(
    Math.abs(plate.cx + side * dx - source.width / 2) / source.width,
    Math.abs(plate.cy + side * dy - source.height / 2) / source.height,
  )));
}

/** All plate-like regions, in source pixels. */
function detectPlates(source) {
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
  const closed = closeHoles(mask, width, height);

  return plateComponents(closed, mask, width, height).map(({ n, cx, cy, angle, length, thickness, touchesBorder }) => ({
    cx: cx / scale, cy: cy / scale, angle, length: length / scale, thickness: thickness / scale, area: n, touchesBorder,
  }));
}

// White letters punch holes into the blue mask; a horizontal+vertical dilation then erosion closes them.
function closeHoles(mask, width, height, radius = 3) {
  const dilated = morph(mask, width, height, radius, 1);
  return morph(dilated, width, height, radius, 0);
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

// `raw` is the mask before closing: closing stretches a plate lying a few pixels from the border up to it.
function plateComponents(mask, raw, width, height) {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const members = new Int32Array(mask.length);
  const minArea = width * height * MIN_AREA_SHARE;
  const plates = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 0, n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, touchesBorder = false;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const p = stack[--top];
      members[n] = p;
      const x = p % width, y = (p - x) / width;
      if (raw[p] && (x === 0 || y === 0 || x === width - 1 || y === height - 1)) touchesBorder = true;
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
    const angle = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);
    plates.push({ n, angle, touchesBorder, ...orientedExtent(members.subarray(0, n), width, cx, cy, angle) });
  }
  return plates;
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
