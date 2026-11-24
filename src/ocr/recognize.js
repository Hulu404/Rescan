// Label recognition: locate the model plate, align, OCR each field window in several
// preprocessing variants and keep only values the variants agree on.
import { darkComponents, loadBitmap, renderRegion, renderRotatedWindow, toneCanvas } from './image.js';
import { findFramedPlate, findModelPlate } from './locate.js';
import { modelAmbiguity, parseModelText, parsePowerText, parseSerialText, resolveZeroOh, settleModel, vote } from '../../shared/fields.js';

// Field windows relative to the plate centre. left/right are in plate length (L); top/bottom are in
// plate thickness (T) for the plate itself and in L for the rows below it. Measured row centres:
// power box 0.31L, SN row 0.54–0.58L below the plate centre on all sample photos. Thickness is not
// used for the rows: pen marks over the plate edges shrink it (toric-01), while length stays stable.
const WINDOWS = {
  model: { left: -0.6, right: 0.6, top: -0.7, bottom: 0.7, across: 'thickness', invert: true },
  power: { left: -0.75, right: 0.7, top: 0.17, bottom: 0.46, across: 'length', invert: false },
  serial: { left: -0.75, right: 0.7, top: 0.46, bottom: 0.67, across: 'length', invert: false },
};
// Inside the plate-anchored SN window the row position already identifies the serial.
const PARSERS = { model: parseModelText, power: parsePowerText, serial: text => parseSerialText(text, { requireTag: false }) };
// Preprocessing variants per field; the vote keeps only values several variants agree on.
// size: rendered plate thickness in pixels. channel 'red' drops red/pink pen marks into the background.
// Model variants were chosen on a grid of 60 settings over the sample photos: each alone reads the
// plate text (up to O/0) on 5 of 6 photos, and they differ in scale, channel and binarization so their
// mistakes do not coincide. The previous 60/80 px red + adaptive set read white-on-navy text poorly.
const TEXT_VARIANTS = [60, 80].flatMap(size => [false, 'adaptive'].map(binarize => ({ size, channel: 'red', binarize })));
const VARIANTS = {
  model: [
    { size: 40, channel: 'red', binarize: false },
    { size: 40, channel: 'luma', binarize: true },
    { size: 50, channel: 'luma', binarize: false },
    { size: 60, channel: 'red', binarize: false },
  ],
  power: TEXT_VARIANTS,
  serial: TEXT_VARIANTS,
};
// The model plate carries only "#", capital letters and digits; anything else is noise.
const MODEL_CHARSET = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const FALLBACK_MAX_SIDE = 2400;
const SINGLE_LINE = '7';
const AUTO_PAGE = '3';

/**
 * @param {Blob} file  photo from camera or gallery
 * @param {{recognize:Function,setParameters:Function}} worker  tesseract.js worker ('eng')
 * @param {{framed?:boolean}} [options]  framed: the photo is the camera guide area, so the target label is
 *   the one in its middle and labels cut by the border are neighbours
 * @returns {Promise<{fields:{model:string,power:string,serial:string}, review:object, crops:object, raw:string, method:string}>}
 */
export async function recognizeLabel(file, worker, { framed = false } = {}) {
  let bitmap;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    // The browser could not decode the image for canvas work; Tesseract may still read the file itself.
    return readPages([{ label: 'файл', image: () => file }], worker, 'undecoded-file');
  }
  try {
    const target = framed ? findFramedPlate(bitmap) : null;
    // Only neighbouring or cut labels are in the guide: reading the page would return someone else's values.
    if (target && !target.plate && target.found > 0) return emptyResult('misframed', MISFRAMED_NOTE);
    const plate = target ? target.plate : findModelPlate(bitmap);
    const located = plate ? await recognizeByPlate(bitmap, plate, worker) : null;
    if (located && located.found > 0) return located.result;
    if (framed && plate) return emptyResult('unreadable', UNREADABLE_NOTE);
    return await recognizeWholeImage(bitmap, worker);
  } finally {
    bitmap.close?.();
  }
}

const MISFRAMED_NOTE = 'Этикетка в рамке не целиком или не по центру — переснимите';
const UNREADABLE_NOTE = 'Этикетка в рамке не читается — переснимите ближе и без бликов';

/** Nothing is filled: the target label could not be read, and other text in the guide may be a neighbour's. */
function emptyResult(method, note) {
  const names = Object.keys(WINDOWS);
  const review = Object.fromEntries(names.map(name => [name, { status: 'missing', candidates: [], needsCheck: true, note }]));
  return { fields: Object.fromEntries(names.map(name => [name, ''])), review, crops: {}, raw: '', method };
}

async function recognizeByPlate(bitmap, plate, worker) {
  await worker.setParameters({ tessedit_pageseg_mode: SINGLE_LINE });
  // The plate axis fixes rotation up to 180°; the side where "#MODEL" reads correctly wins.
  let best = null;
  for (const flip of [0, Math.PI]) {
    const frame = { ...plate, angle: plate.angle + flip };
    const model = await readField(bitmap, frame, 'model', worker, VARIANTS.model.slice(0, 1));
    const score = model.readings.filter(Boolean).length * 100 + model.confidence;
    if (!best || score > best.score) best = { frame, score };
  }
  const fields = {}, review = {}, crops = {}, raw = [];
  let found = 0;
  for (const name of Object.keys(WINDOWS)) {
    const read = await readField(bitmap, best.frame, name, worker, VARIANTS[name]);
    const boxes = name === 'model' ? plateGlyphBoxes(bitmap, best.frame) : null;
    const readings = boxes ? matchGlyphCount(read.readings, boxes) : read.readings;
    const voted = vote(readings);
    const shape = boxes ? shapeFromBoxes(voted.value, boxes) : null;
    const decision = name === 'model' ? settleModel(voted, shape) : voted;
    fields[name] = decision.value;
    review[name] = describe(name, decision, '', shape);
    crops[name] = read.crop;
    raw.push(`[${name}] ` + read.texts.join(' ‖ '));
    if (decision.value || decision.candidates.length) found++;
  }
  return { found, result: { fields, review, crops, raw: raw.join('\n'), method: 'plate' } };
}

async function readField(bitmap, frame, name, worker, variants) {
  const win = WINDOWS[name];
  const acrossUnit = win.across === 'length' ? frame.length : frame.thickness;
  const readings = [], texts = [];
  const regions = new Map();
  let crop = '', confidence = 0;
  const isModel = name === 'model';
  await worker.setParameters({ tessedit_char_whitelist: isModel ? MODEL_CHARSET : '' });
  try {
    for (const { size, channel, binarize } of variants) {
      if (!regions.has(size)) regions.set(size, renderFieldWindow(bitmap, frame, win, acrossUnit, size));
      const region = regions.get(size);
      if (!crop) crop = region.toDataURL('image/jpeg', 0.85);
      const { data } = await worker.recognize(toneCanvas(region, { channel, invert: win.invert, binarize }));
      texts.push(data.text.trim().replace(/\s*\n\s*/g, ' / '));
      readings.push(PARSERS[name](data.text));
      confidence = Math.max(confidence, data.confidence);
    }
  } finally {
    if (isModel) await worker.setParameters({ tessedit_char_whitelist: '' });
  }
  return { readings, texts, crop, confidence };
}

function renderFieldWindow(bitmap, frame, win, acrossUnit, size) {
  return renderRotatedWindow(bitmap, {
    cx: frame.cx, cy: frame.cy, angle: frame.angle, scale: size / frame.thickness,
    left: win.left * frame.length, right: win.right * frame.length,
    top: win.top * acrossUnit, bottom: win.bottom * acrossUnit,
  });
}

// Glyph geometry is measured on our own segmentation of the plate, not on Tesseract symbol boxes:
// those are unreliable (a "W" box spanning the whole word, a 5 px wide "3" were observed).
const GEOMETRY_PIXELS = 80;
// Letters on the plate are about half to 0.9 of the plate thickness tall; smaller blobs are noise.
const GLYPH_MIN_HEIGHT = 0.4;
const GLYPH_MAX_HEIGHT = 1.0;
const GLYPH_MAX_WIDTH = 1.2;

/**
 * White glyphs of the model plate as separate boxes, left to right ('#' included).
 * Bold sans letters on the plate do not touch, so one connected region is one glyph.
 */
function plateGlyphBoxes(bitmap, frame) {
  const region = renderFieldWindow(bitmap, frame, WINDOWS.model, frame.thickness, GEOMETRY_PIXELS);
  const toned = toneCanvas(region, { channel: 'red', invert: true, binarize: true });
  return darkComponents(toned)
    .map(b => ({ width: b.x1 - b.x0 + 1, height: b.y1 - b.y0 + 1, touchesBorder: b.touchesBorder }))
    .filter(b => !b.touchesBorder && b.height >= GLYPH_MIN_HEIGHT * GEOMETRY_PIXELS && b.height <= GLYPH_MAX_HEIGHT * GEOMETRY_PIXELS && b.width <= GLYPH_MAX_WIDTH * GEOMETRY_PIXELS);
}

/** Glyph boxes for the characters of `model`: with the '#' box first, or without it. */
function boxesFor(model, boxes) {
  if (boxes.length === model.length + 1) return boxes.slice(1);
  if (boxes.length === model.length) return boxes;
  return null;
}

/**
 * Drops readings whose length disagrees with the number of glyphs on the plate ("CNWO0T2" for six
 * glyphs). Applied only when at least one reading agrees, i.e. the segmentation itself is confirmed.
 */
function matchGlyphCount(readings, boxes) {
  const fits = readings.map(r => Boolean(r && boxesFor(r, boxes)));
  return fits.some(Boolean) ? readings.map((r, i) => (fits[i] ? r : '')) : readings;
}

/** O/0 decision for the voted model from the measured glyph boxes; null when they do not line up. */
function shapeFromBoxes(value, boxes) {
  const matched = value && boxesFor(value, boxes);
  return matched ? resolveZeroOh([...value].map((text, i) => ({ text, width: matched[i].width, height: matched[i].height }))) : null;
}

async function recognizeWholeImage(bitmap, worker) {
  const scale = Math.min(2, FALLBACK_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const pages = [0, 90, 270, 180].map(angle => ({ label: `${angle}°`, image: () => toneCanvas(renderRegion(bitmap, { scale, angle }), { channel: 'red' }) }));
  return readPages(pages, worker, 'whole-image');
}

/** Reads whole pages in order until one yields any field; values cannot be cross-checked and are flagged. */
async function readPages(pages, worker, method) {
  await worker.setParameters({ tessedit_pageseg_mode: AUTO_PAGE });
  const readings = { model: [], power: [], serial: [] }, raw = [];
  for (const { label, image } of pages) {
    const { data } = await worker.recognize(image());
    raw.push(`[${label}] ${data.text.trim()}`);
    const lines = data.text.split('\n');
    readings.model.push(firstParsed(lines, parseModelText));
    readings.power.push(firstParsed(lines, parsePowerText));
    readings.serial.push(firstParsed(lines, parseSerialText));
    if (readings.model.at(-1) || readings.power.at(-1) || readings.serial.at(-1)) break;
  }
  const fields = {}, review = {};
  for (const name of Object.keys(readings)) {
    // A single whole-image pass cannot be cross-checked, so any value still needs review.
    const voted = vote(readings[name], { minVotes: 1 });
    // Without the plate there is no glyph geometry: a model with O/0 is left for the employee to pick.
    const shape = null;
    const decision = name === 'model' ? settleModel(voted, shape) : voted;
    fields[name] = decision.value;
    review[name] = describe(name, decision, 'Этикетка не найдена на снимке — значение прочитано без привязки к полю', shape);
  }
  return { fields, review, crops: {}, raw: raw.join('\n'), method };
}

function firstParsed(lines, parser) {
  const values = [...new Set(lines.map(parser).filter(Boolean))];
  return values.length === 1 ? values[0] : '';
}

function describe(name, decision, extra = '', shape = null) {
  const notes = [];
  if (decision.status === 'missing') notes.push('Не распознано — введите по этикетке');
  if (decision.status === 'conflict') notes.push(name === 'model' && decision.candidates.some(c => /[O0]/.test(c))
    ? 'Буква O или цифра 0 — по снимку не определить. Выберите вариант по этикетке'
    : 'Варианты распознавания расходятся — выберите или введите вручную');
  if (name === 'model') { const hint = modelAmbiguity(decision.value, shape ?? {}); if (hint) notes.push(hint); }
  if (extra && decision.value) notes.push(extra);
  return { status: decision.status, candidates: decision.candidates, needsCheck: decision.status !== 'ok' || notes.length > 0, note: notes.join('. ') };
}
