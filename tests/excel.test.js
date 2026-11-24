import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createExcel } from '../server/excel.js';
import { missingCustomerFields, readCustomer } from '../server/customer.js';

const CUSTOMER = { name: 'ООО Клиника', email: 'orders@example.com', city: 'Москва', soldTo: '100000001', shipTo: '100000002' };
const lens = (model, power, serial) => ({ scanned_at: '2026-11-18T22:30:00Z', model, power, serial });

async function load(rows, customer = CUSTOMER) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await createExcel(rows, customer));
  return { book, sheet: book.worksheets[0] };
}

test('consignment order has the customer header of the Alcon form', async () => {
  const { book, sheet } = await load([lens('PXYWT4', 8.5, '16206100068')]);
  assert.deepEqual(book.worksheets.map(s => s.name), ['Consignment Order']);
  assert.deepEqual(['B2', 'B3', 'B4', 'E2', 'E3'].map(a => sheet.getCell(a).value), ['Customer Name', 'Customer Email ID', 'Customer City', 'Sold-to', 'Ship-to']);
  assert.equal(sheet.getCell('C2').value, 'ООО Клиника');
  assert.deepEqual(sheet.getCell('C3').value, { text: 'orders@example.com', hyperlink: 'mailto:orders@example.com' });
  assert.equal(sheet.getCell('C4').value, 'Москва');
  assert.equal(sheet.getCell('F2').value, 100000001);
  assert.equal(sheet.getCell('F3').value, 100000002);
  for (const a of ['C2', 'C3', 'C4']) assert.equal(sheet.getCell(a).fill.fgColor.argb, 'FFFFFF00');
  assert.deepEqual(['B6', 'C6', 'D6'].map(a => sheet.getCell(a).value), ['Serial Number', 'Model', 'Diopter']);
});

test('Alcon logo is embedded to the right of Sold-to', async () => {
  const { book, sheet } = await load([lens('PXYWT4', 8.5, '16206100068')]);
  const [image] = sheet.getImages();
  assert.equal(sheet.getImages().length, 1);
  assert.equal(image.range.tl.nativeCol, 6);
  assert.ok(book.getImage(image.imageId).buffer.length > 1000);
});

test('lens rows: serial without spaces as text, model, diopter times ten', async () => {
  const { sheet } = await load([lens('PXYWT4', 8.5, '16206100 068'), lens('SY60WF', 6, '26174807 015'), lens('SN60AT', -2.5, '001234 007'), lens('SN60AT', 0, '1')]);
  assert.deepEqual([7, 8, 9, 10].map(r => sheet.getCell(`B${r}`).value), ['16206100068', '26174807015', '001234007', '1']);
  assert.equal(sheet.getCell('B9').type, ExcelJS.ValueType.String);
  assert.deepEqual([7, 8, 9, 10].map(r => sheet.getCell(`D${r}`).value), [85, 60, -25, 0]);
});

test('diopter is exact: no float noise and quarter steps are kept', async () => {
  const { sheet } = await load([lens('A', 19.3, '1'), lens('B', 18.25, '2'), lens('C', '20.5', '3')]);
  assert.deepEqual([7, 8, 9].map(r => sheet.getCell(`D${r}`).value), [193, 182.5, 205]);
});

test('text from labels is never a formula', async () => {
  const { sheet } = await load([lens('=1+1', 1, '=2+2')]);
  assert.equal(sheet.getCell('C7').value, '=1+1');
  assert.equal(sheet.getCell('C7').type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('B7').type, ExcelJS.ValueType.String);
});

test('empty bordered rows go down to row 29 and the table grows past it', async () => {
  const short = (await load([lens('A', 1, '1')])).sheet;
  assert.ok(short.getCell('D29').border?.bottom);
  assert.equal(short.getCell('D30').border?.bottom, undefined);
  const rows = Array.from({ length: 40 }, (_, i) => lens('A', 1, String(i)));
  const long = (await load(rows)).sheet;
  assert.equal(long.getCell('B46').value, '39');
  assert.ok(long.getCell('B46').border?.bottom);
});

test('repeated models are highlighted by a rule over the whole table', async () => {
  const { sheet } = await load(Array.from({ length: 40 }, (_, i) => lens('A', 1, String(i))));
  const [format] = sheet.conditionalFormattings;
  assert.equal(format.ref, 'C7:C46');
  assert.match(format.rules[0].formulae[0], /COUNTIF\(\$C\$7:\$C\$46,\$C7\)>1/);
});

test('customer data comes from the environment; what is missing is named and left blank', async () => {
  const env = { CUSTOMER_NAME: ' ООО Клиника ', CUSTOMER_EMAIL: 'a@b.ru', CUSTOMER_CITY: 'Москва', CUSTOMER_SOLD_TO: '1', CUSTOMER_SHIP_TO: '2' };
  assert.deepEqual(readCustomer(env), { name: 'ООО Клиника', email: 'a@b.ru', city: 'Москва', soldTo: '1', shipTo: '2' });
  assert.deepEqual(missingCustomerFields(env), []);
  assert.deepEqual(missingCustomerFields({ ...env, CUSTOMER_EMAIL: ' ' }), ['CUSTOMER_EMAIL']);
  const { sheet } = await load([lens('A', 1, '1')], readCustomer({}));
  assert.equal(sheet.getCell('C2').value, null);
  assert.equal(sheet.getCell('C3').value, null);
  assert.equal(sheet.getCell('F2').value, null);
});
