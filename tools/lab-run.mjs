// Dev-only OCR lab runner. Usage: node tools/lab-run.mjs <script.js> [outDir]
// The script runs inside a Chromium page with `lab` (real tesseract.js + src/ocr modules).
// If it returns {text, images:{name:dataURL}}, images are written into outDir.
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const [script, outDir = '.'] = process.argv.slice(2);
const server = await createServer({ server: { port: 5181, host: '127.0.0.1', strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('console', m => console.log('[page]', m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('http://127.0.0.1:5181/tools/ocr-lab.html');
  await page.waitForFunction(() => window.lab?.ready);
  const result = await page.evaluate(`(async () => { ${readFileSync(script, 'utf8')} })()`);
  if (result && typeof result === 'object' && result.images) {
    mkdirSync(outDir, { recursive: true });
    for (const [name, url] of Object.entries(result.images)) writeFileSync(join(outDir, name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    console.log(result.text ?? '');
  } else console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 1));
} finally { await browser.close(); await server.close(); }
