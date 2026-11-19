// Pure parsing and voting for the three label fields. Shared by browser OCR and Node tests.
// Rules: never swap O/0, I/1 etc.; never treat a missing value as zero; prefer empty over wrong.
import { normalizeSerial } from './label.js';

/** Character pairs that this label font renders almost identically. */
const CONFUSABLE = /[O0I1L]/;
const CONFUSABLE_HINT = 'O и 0, I/L и 1 на этикетке выглядят почти одинаково';

const MODEL_PATTERN = /^[A-Z0-9][A-Z0-9./-]{2,15}$/;
const IOL_POWER_MIN = -15;
const IOL_POWER_MAX = 45;
const POWER_STEP = 0.25;
const SERIAL_MIN_DIGITS = 6;
const SERIAL_PATTERN = /^\d+(?: \d+)*$/;

const clean = text => String(text ?? '').replace(/[“”"'‘’`|[\]{}()]/g, ' ').replace(/\s+/g, ' ').trim();

/** Model printed as "#CODE" on the plate, or after MODEL/МОДЕЛЬ. REF is a catalogue number, not a model. */
export function parseModelText(text) {
  const source = clean(text).toUpperCase();
  const tagged = source.match(/#\s*([A-Z0-9][A-Z0-9./-]*)/) ?? source.match(/\b(?:MODEL|МОДЕЛЬ)\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]*)/);
  const value = tagged?.[1] ?? '';
  return MODEL_PATTERN.test(value) && /[A-Z]/.test(value) && /\d/.test(value) ? value : '';
}

/**
 * Optical power: signed number followed by D. Values after CYL/Ø or with mm are other characteristics.
 * Labels always print the sign; an unsigned "4 D" / "0 D" is a fragment of other text, not a power.
 */
export function parsePowerText(text) {
  const source = clean(text).replace(/[−–—]/g, '-');
  const found = [];
  // A sign right after a digit or letter is a hyphen inside other text ("13-10", "2030-01").
  for (const m of source.matchAll(/(?<![\dA-Za-z])([+-])\s?(\d{1,2})(?:\s?[.,]\s?(\d{1,2}))?\s?(?:D|ДПТР)(?![A-Z])/gi)) {
    const before = source.slice(Math.max(0, m.index - 6), m.index).toUpperCase();
    if (/CYL|ЦИЛ|Ø|AXIS/.test(before)) continue;
    const value = Number(`${m[1] || ''}${m[2]}${m[3] ? '.' + m[3] : ''}`);
    if (!isPlausiblePower(value)) continue;
    found.push(formatPower(value));
  }
  return [...new Set(found)].length === 1 ? found[0] : '';
}

export function isPlausiblePower(value) {
  return Number.isFinite(value) && value >= IOL_POWER_MIN && value <= IOL_POWER_MAX && Number.isInteger(value / POWER_STEP);
}

function formatPower(value) {
  return (value < 0 ? '-' : '+') + String(Math.abs(value));
}

/**
 * Serial after the SN tag: digits and single spaces only; letters mean the read is unreliable.
 * @param {string} text
 * @param {{requireTag?:boolean}} [options]  requireTag:false is for a window already placed on the SN row
 *   (OCR often drops the boxed "SN"); the value must then be the whole text up to UDI, digits only.
 */
export function parseSerialText(text, { requireTag = true } = {}) {
  const source = clean(text).toUpperCase();
  const tag = source.match(/\bS\s?N\b\s*[:#-]?\s*(.*)$/);
  if (!tag && requireTag) return '';
  // Untagged row: a misread boxed tag ("8N", "3N") is a two-character token ending in N.
  const rest = tag ? tag[1] : source.replace(/^\S?N\s+/, '');
  // The UDI box after the number is read as UDI, Ul, UI, U!, UL…; any word starting with U ends the serial.
  const value = rest.split(/\s+(?:U|LOT\b|REF\b|EXP\b)/)[0].trim();
  const digits = value.replace(/\D/g, '');
  if (!SERIAL_PATTERN.test(value) || digits.length < SERIAL_MIN_DIGITS) return '';
  // OCR often drops the gap between digit groups; only spacing is restored, digits stay as read.
  return normalizeSerial(value);
}

/**
 * Combines readings from several preprocessing variants.
 * @param {string[]} readings  parsed value per variant ('' when the variant produced nothing valid)
 * @returns {{value:string, status:'ok'|'conflict'|'missing', candidates:string[], votes:number, total:number}}
 */
export function vote(readings, { minVotes = 2 } = {}) {
  const counts = new Map();
  for (const r of readings) if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const candidates = ranked.map(([v]) => v);
  if (!ranked.length) return { value: '', status: 'missing', candidates, votes: 0, total: readings.length };
  const [[top, topVotes], second] = ranked;
  const clear = topVotes >= minVotes && (!second || topVotes >= 2 * second[1]);
  return { value: clear ? top : '', status: clear ? 'ok' : 'conflict', candidates, votes: topVotes, total: readings.length };
}

/**
 * Returns a warning when a model contains characters this font cannot distinguish reliably.
 * @param {string} model
 * @param {{resolved?:number, unresolved?:number}} [shape]  result of resolveZeroOh for this value
 */
export function modelAmbiguity(model, shape = {}) {
  if (!model || !CONFUSABLE.test(model)) return '';
  const onlyResolvedZeroOh = !/[IL1]/.test(model) && shape.resolved > 0 && !shape.unresolved;
  return onlyResolvedZeroOh ? 'O/0 определены по ширине знака, а не по тексту — сверьте с этикеткой' : CONFUSABLE_HINT;
}

// In the label font the digit 0 is a narrow oval as wide as other digits, the letter O is nearly round.
// Measured digit 0 on 6 photos: width/height 0.33–0.57.
const ZERO_MIN_RATIO = 0.3;
const ZERO_MAX_RATIO = 0.68;
const ZERO_MAX_REL_WIDTH = 1.12;
const OH_MIN_RATIO = 0.8;
const OH_MAX_RATIO = 1.1;
const OH_MIN_REL_WIDTH = 1.25;
// Tesseract symbol boxes are often clipped ("T3|"); a single reference digit is not trusted.
const MIN_REFERENCE_DIGITS = 2;
// A glyph box whose height differs this much from the word's median height is a broken box.
const HEIGHT_TOLERANCE = 0.25;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

/**
 * Decides O vs 0 from glyph geometry, never from the model name.
 * @param {{text:string,width:number,height:number}[]} symbols  glyphs of the model word, without '#'
 * @returns {{value:string, resolved:number, unresolved:number}}
 */
export function resolveZeroOh(symbols) {
  const digitWidths = symbols.filter(s => /^[2-9]$/.test(s.text)).map(s => s.width);
  const digitWidth = digitWidths.length >= MIN_REFERENCE_DIGITS ? median(digitWidths) : 0;
  const wordHeight = median(symbols.map(s => s.height));
  let resolved = 0, unresolved = 0;
  const value = symbols.map(({ text, width, height }) => {
    const upper = text.toUpperCase();
    if (upper !== 'O' && upper !== '0') return upper;
    const ratio = width / Math.max(1, height);
    const rel = digitWidth ? width / digitWidth : null;
    const plausibleBox = Math.abs(height - wordHeight) <= HEIGHT_TOLERANCE * wordHeight;
    const zero = plausibleBox && ratio >= ZERO_MIN_RATIO && ratio <= ZERO_MAX_RATIO && (rel === null || rel <= ZERO_MAX_REL_WIDTH);
    const oh = plausibleBox && ratio >= OH_MIN_RATIO && ratio <= OH_MAX_RATIO && (rel === null || rel >= OH_MIN_REL_WIDTH);
    if (zero === oh) { unresolved++; return upper; }
    resolved++;
    return zero ? '0' : 'O';
  }).join('');
  return { value, resolved, unresolved };
}

/**
 * Final model decision. A model whose O/0 the glyph geometry did not settle is left empty:
 * both spellings are offered for the employee to pick, nothing is pre-filled.
 * @param {{value:string,status:string,candidates:string[]}} voted  result of vote()
 * @param {{value:string,resolved:number,unresolved:number}|null} shape  resolveZeroOh() for voted.value
 */
export function settleModel(voted, shape) {
  const value = shape ? shape.value : voted.value;
  const settled = shape && !shape.unresolved;
  if (!value || !/[O0]/.test(value) || settled) return { ...voted, value };
  const spellings = [value.replace(/0/g, 'O'), value.replace(/O/g, '0')];
  const candidates = [...new Set([...spellings, ...voted.candidates])];
  return { ...voted, value: '', status: 'conflict', candidates };
}
