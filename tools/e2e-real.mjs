// Real end-to-end check: photo → real tesseract.js OCR → form → employee confirmation → Supabase → Excel.
// Nothing is stubbed. Uses the production build, the real Express API and the Supabase project from .env.
// Writes one test session owned by 'local-developer' (DEV_AUTH, loopback only) — invisible to Telegram staff.
// Usage: npm run build && node tools/e2e-real.mjs [photo] [--memory-db]
//   --memory-db: storage only is replaced by an in-memory API that uses the real server validation
//   (parsePower) and the real Excel generator (server/excel.js). OCR, UI and Excel stay real.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { preview } from 'vite';
import { parsePower } from '../shared/label.js';
import { createExcel } from '../server/excel.js';
import { readCustomer } from '../server/customer.js';
import { readFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { chromium } from '@playwright/test';
import ExcelJS from 'exceljs';

const PORT = 3011;
const args = process.argv.slice(2);
const memoryDb = args.includes('--memory-db');
const photo = args.find(a => !a.startsWith('--')) ?? 'samples/labels/alcon-clareon-toric-01.png';
const truth = JSON.parse(readFileSync('samples/labels/expected.json', 'utf8'))[basename(photo)];
if (!truth) throw new Error(`Нет эталона для ${photo}`);
const LABELS = { model: 'Модель линзы', power: 'Оптическая сила, D', serial: 'Серийный номер (SN)' };

const server = memoryDb ? await preview({ preview: { port: PORT, host: '127.0.0.1', strictPort: true }, logLevel: 'error' }) : await startApiServer();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  if (memoryDb) await page.route('**/api/**', memoryApi());
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.getByRole('button', { name: 'Начать сканирование' }).click();
  await page.locator('input[type=file]').first().setInputFiles(photo);
  const started = Date.now();
  await page.getByRole('heading', { name: 'Проверьте данные' }).waitFor();
  await page.locator('.ocr-progress').waitFor({ state: 'detached', timeout: 120000 });
  const ocrMs = Date.now() - started;

  const report = [];
  for (const [key, label] of Object.entries(LABELS)) {
    const input = page.getByLabel(label, { exact: true });
    const ocr = await input.inputValue();
    const note = await page.locator(`#${key}-note`).textContent().catch(() => '');
    // The employee checks each field against the label and types what the photo shows if it differs.
    if (ocr !== truth[key] && !(key === 'power' && Number(ocr) === Number(truth[key]))) await input.fill(truth[key]);
    report.push({ field: key, ocr: ocr || '—', saved: await input.inputValue(), byHand: (await input.inputValue()) !== ocr, note: note || '' });
  }
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/e2e-real-form.png', fullPage: true });
  const confirm = page.getByLabel('Выделенные поля сверены с этикеткой');
  if (await confirm.count()) await confirm.check();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByText(`SN ${truth.serial}`, { exact: true }).waitFor();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Завершить и скачать Excel' }).click();
  const file = await (await download).path();
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(file);
  const sheet = book.worksheets[0];
  const row = sheet.getRow(7);
  const excel = { sheet: sheet.name, secondLens: sheet.getCell('B8').value, serial: row.getCell(2).value, serialType: typeof row.getCell(2).value, model: row.getCell(3).value, diopter: row.getCell(4).value };
  const session = (await page.locator('.session-bar').textContent()).match(/№ (\w+)/)?.[1];
  console.log(JSON.stringify({ photo, ocrMs, fields: report, excel, testSessionPrefix: session }, null, 1));
  const ok = excel.sheet === 'Consignment Order' && excel.secondLens === null && excel.model === truth.model && excel.diopter === Math.round(Number(truth.power) * 100) / 10 && excel.serial === truth.serial.replace(/\s/g, '');
  console.log(ok ? 'E2E OK' : 'E2E MISMATCH');
  process.exitCode = ok ? 0 : 1;
} finally {
  await browser.close();
  memoryDb ? await server.close() : server.kill();
}

async function startApiServer() {
  const child = spawn(process.execPath, ['--env-file=.env', 'server/index.js'], { env: { ...process.env, PORT: String(PORT), DEV_AUTH: 'true', NODE_ENV: 'development' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { child.stdout.on('data', d => String(d).includes('ready') && resolve()); child.on('exit', c => reject(new Error('server exited ' + c))); });
  return child;
}

/** In-memory replacement for Supabase only; request validation and Excel are the real server code. */
function memoryApi() {
  const sessions = new Map(), rows = [];
  return async route => {
    const req = route.request(), path = new URL(req.url()).pathname, body = req.postDataJSON?.() ?? null;
    const id = path.split('/')[3];
    if (path === '/api/sessions' && req.method() === 'GET') return route.fulfill({ json: { timeZone: 'Europe/Moscow', sessions: [...sessions.values()] } });
    if (path === '/api/sessions') { const s = { id: body.id, created_at: new Date().toISOString(), completed_at: null }; sessions.set(s.id, s); return route.fulfill({ json: s }); }
    if (path.endsWith('/lenses')) {
      let power; try { power = parsePower(body.power); } catch (e) { return route.fulfill({ status: 400, json: { error: e.message } }); }
      const row = { id: body.id ?? randomUUID(), session_id: id, model: body.model.trim(), power, serial: body.serial.trim(), scanned_at: new Date().toISOString() };
      rows.push(row); return route.fulfill({ json: row });
    }
    if (path.endsWith('/complete')) { sessions.get(id).completed_at = new Date().toISOString(); return route.fulfill({ json: { ok: true } }); }
    if (path.endsWith('/excel')) return route.fulfill({ status: 200, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Buffer.from(await createExcel(rows.filter(r => r.session_id === id), readCustomer())) });
    return route.fulfill({ json: { session: sessions.get(id), rows: rows.filter(r => r.session_id === id) } });
  };
}
