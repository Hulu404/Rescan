// OCR evaluation on real label photos against a human-made ground truth.
// Usage: node tools/ocr-eval.mjs [--no-synthetic]
// Runs the real tesseract.js + src/ocr pipeline in Chromium. No stubs, no network OCR services.
// Writes the full report to test-results/ocr-report.md.
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const DIR = 'samples/labels';
const FIELDS = ['model', 'power', 'serial'];
const expected = JSON.parse(readFileSync(`${DIR}/expected.json`, 'utf8'));
const files = readdirSync(DIR).filter(f => /\.(png|jpe?g|webp)$/i.test(f) && expected[f]);
// Derived variants of each real photo check orientation/scale handling; they are not new evidence of accuracy.
const VARIANTS = process.argv.includes('--no-synthetic') ? ['original'] : ['original', 'rot90', 'rot180', 'rot270', 'skew8', 'half', 'jpeg60'];

const rows = await runAll();
const report = buildReport(rows);
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/ocr-report.md', report);
console.log(report.split('## Сырой текст')[0]);

async function runAll() {
  const server = await createServer({ server: { port: 5181, host: '127.0.0.1', strictPort: true }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch();
  const out = [];
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:5181/tools/ocr-lab.html');
    await page.waitForFunction(() => window.lab?.ready);
    for (const file of files) for (const variant of VARIANTS) {
      const result = await page.evaluate(runOne, { url: `/${DIR}/${file}`, variant });
      out.push({ file, variant, truth: expected[file], ...result });
      console.error(`done ${file} ${variant}: ${result.ms} ms`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return out;
}

function same(field, got, truth) {
  if (!got) return false;
  return field === 'power' ? Number(String(got).replace(',', '.')) === Number(truth) : got === truth;
}

function grade(field, got, truth, review) {
  if (!got) return review?.candidates?.length ? 'пусто, есть варианты' : 'пусто';
  return same(field, got, truth) ? 'верно' : 'ОШИБКА';
}

function buildReport(rows) {
  const table = ['| изображение | вариант | алгоритм | поле | эталон | результат | оценка | пометка для сотрудника |', '|---|---|---|---|---|---|---|---|'];
  const summary = {};
  for (const r of rows) for (const algo of ['old', 'new']) for (const f of FIELDS) {
    const got = r[algo].fields[f] ?? '';
    const review = algo === 'new' ? r.new.review[f] : null;
    const g = grade(f, got, r.truth[f], review);
    const key = `${algo === 'old' ? 'старый' : 'новый'} / ${f}`;
    summary[key] ??= {};
    summary[key][g] = (summary[key][g] ?? 0) + 1;
    const note = review ? [review.note, review.candidates?.length ? 'варианты: ' + review.candidates.join(', ') : ''].filter(Boolean).join('; ') : '';
    table.push(`| ${r.file} | ${r.variant} | ${algo === 'old' ? 'старый' : 'новый'} | ${f} | ${r.truth[f]} | ${got || '—'} | ${g} | ${note} |`);
  }
  const perLabel = rows.map(r => {
    const all = algo => FIELDS.every(f => same(f, r[algo].fields[f], r.truth[f]));
    const wrong = FIELDS.filter(f => r.new.fields[f] && !same(f, r.new.fields[f], r.truth[f]));
    return `- ${r.file} / ${r.variant}: старый — ${all('old') ? 'все 3 верно' : 'не все'}; новый — ${all('new') ? 'все 3 верно' : 'не все'}${wrong.length ? '; НЕВЕРНО заполнено: ' + wrong.join(', ') : ''} (метод: ${r.new.method}, ${r.ms} мс)`;
  });
  const raw = rows.map(r => `### ${r.file} ${r.variant}\n\`\`\`\n${r.new.raw}\n\`\`\``);
  return [`# Проверка OCR\n\nСнимков с эталоном: ${files.length}. Вариантов на снимок: ${VARIANTS.length} (кроме original — синтетические производные того же снимка).`, '', ...table, '', '## Итог по полям', '```', JSON.stringify(summary, null, 1), '```', '', '## По этикетке целиком', ...perLabel, '', '## Сырой текст (новый)', ...raw].join('\n');
}

// Runs inside the page.
async function runOne({ url, variant }) {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const rotation = { rot90: 90, rot180: 180, rot270: 270 }[variant] ?? 0;
  const k = variant === 'half' ? 0.5 : 1;
  const skew = variant === 'skew8' ? (8 * Math.PI) / 180 : 0;
  const swap = rotation === 90 || rotation === 270;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((swap ? bitmap.height : bitmap.width) * k);
  canvas.height = Math.round((swap ? bitmap.width : bitmap.height) * k);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180 + skew);
  ctx.scale(k, k);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  const input = await new Promise(resolve => canvas.toBlob(resolve, variant === 'jpeg60' ? 'image/jpeg' : 'image/png', 0.6));
  window.__worker ??= await window.lab.createWorker('eng', 1);
  const worker = window.__worker;
  // tesseract.js default (PSM 6) — what the app used before the rework.
  await worker.setParameters({ tessedit_pageseg_mode: '6' });
  const old = { fields: window.lab.parseLabelLegacy((await worker.recognize(input)).data.text) };
  const started = performance.now();
  const res = await window.lab.recognizeLabel(input, worker);
  return { old, new: { fields: res.fields, review: res.review, raw: res.raw, method: res.method }, ms: Math.round(performance.now() - started) };
}
