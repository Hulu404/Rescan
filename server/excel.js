// Alcon "Consignment Order" form: customer header, logo and one row per lens.
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';

const LOGO = new URL('./assets/alcon-logo.png', import.meta.url);
// Pixels; the source picture is 720 × 197.
const LOGO_SIZE = { width: 176, height: 48 };
const LOGO_POSITION = { col: 6.5, row: 2.3 };
const COLUMN_WIDTHS = [4, 38, 34, 12, 12, 13];
const ROW_HEIGHT = 18;
const HEADER_ROW = 6;
const FIRST_ROW = HEADER_ROW + 1;
// The form has empty lines down to this row even when there are few lenses.
const LAST_FORM_ROW = 29;
const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
const BLACK = { argb: 'FF000000' };
const LINK_BLUE = { argb: 'FF0563C1' };
const REPEATED_MODEL_RED = { argb: 'FF9C0006' };
const FONT = { name: 'Calibri', size: 11 };
const BOLD = { ...FONT, bold: true };
const LINK = { ...FONT, size: 14, underline: true, color: LINK_BLUE };
const CENTER = { horizontal: 'center', vertical: 'middle' };
const RIGHT = { horizontal: 'right', vertical: 'middle' };

/**
 * @param {{model:string, power:number|string, serial:string}[]} rows
 * @param {{name:string, email:string, city:string, soldTo:string, shipTo:string}} customer
 * @returns {Promise<ArrayBuffer>} .xlsx file
 */
export async function createExcel(rows, customer) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Consignment Order', { views: [{ showGridLines: false }] });
  COLUMN_WIDTHS.forEach((width, i) => { sheet.getColumn(i + 1).width = width; });
  const lastRow = Math.max(LAST_FORM_ROW, HEADER_ROW + rows.length);
  for (let row = 1; row <= lastRow; row++) sheet.getRow(row).height = ROW_HEIGHT;
  addCustomer(sheet, customer);
  sheet.addImage(workbook.addImage({ buffer: await readFile(LOGO), extension: 'png' }), { tl: LOGO_POSITION, ext: LOGO_SIZE, editAs: 'oneCell' });
  addLenses(sheet, rows, lastRow);
  return workbook.xlsx.writeBuffer();
}

function addCustomer(sheet, { name, email, city, soldTo, shipTo }) {
  const link = email ? { text: email, hyperlink: `mailto:${email}` } : null;
  const left = [['Customer Name', name || null, BOLD], ['Customer Email ID', link, LINK], ['Customer City', city || null, BOLD]];
  left.forEach(([label, value, font], i) => {
    setCell(sheet, `B${i + 2}`, label, { font: BOLD, alignment: RIGHT, border: box('medium') });
    setCell(sheet, `C${i + 2}`, value, { font, alignment: CENTER, border: box('medium'), fill: YELLOW });
  });
  [['Sold-to', soldTo], ['Ship-to', shipTo]].forEach(([label, value], i) => {
    setCell(sheet, `E${i + 2}`, label, { font: BOLD, alignment: RIGHT, border: box('medium') });
    setCell(sheet, `F${i + 2}`, accountNumber(value), { font: BOLD, alignment: RIGHT, border: box('medium') });
  });
}

function addLenses(sheet, rows, lastRow) {
  const cell = { font: FONT, alignment: CENTER, border: box('thin') };
  ['Serial Number', 'Model', 'Diopter'].forEach((title, i) => setCell(sheet, `${'BCD'[i]}${HEADER_ROW}`, title, { ...cell, font: BOLD }));
  for (let number = FIRST_ROW; number <= lastRow; number++) {
    const lens = rows[number - FIRST_ROW];
    setCell(sheet, `B${number}`, lens ? compactSerial(lens.serial) : null, { ...cell, numFmt: '@' });
    setCell(sheet, `C${number}`, lens ? String(lens.model) : null, cell);
    setCell(sheet, `D${number}`, lens ? formDiopter(lens.power) : null, cell);
  }
  // The form prints models that occur more than once in red.
  sheet.addConditionalFormatting({
    ref: `C${FIRST_ROW}:C${lastRow}`,
    rules: [{ type: 'expression', formulae: [`COUNTIF($C$${FIRST_ROW}:$C$${lastRow},$C${FIRST_ROW})>1`], style: { font: { color: REPEATED_MODEL_RED } } }],
  });
}

function setCell(sheet, address, value, style) {
  const cell = sheet.getCell(address);
  cell.value = value;
  cell.style = style;
}

function box(style) {
  const edge = { style, color: BLACK };
  return { top: edge, left: edge, bottom: edge, right: edge };
}

/** The form writes SN without the gap printed on the label; kept as text so leading zeros survive. */
function compactSerial(serial) {
  return String(serial).replace(/\s+/g, '');
}

/** The form writes diopters times ten: 8.5 D → 85. Rounding only removes binary float noise. */
function formDiopter(power) {
  return Math.round(Number(power) * 1000) / 100;
}

function accountNumber(value) {
  return /^[1-9]\d{0,14}$/.test(value) ? Number(value) : value || null;
}
