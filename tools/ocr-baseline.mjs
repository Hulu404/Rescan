// Baseline: current algorithm = raw file -> tesseract eng -> parseLabel (no preprocessing).
import { createWorker } from 'tesseract.js';
import { parseLabel } from '../shared/label.js';
const files = process.argv.slice(2);
const worker = await createWorker('eng', 1);
for (const f of files) {
  const { data } = await worker.recognize(f);
  console.log('=== ' + f + '\n--- RAW ---\n' + data.text + '\n--- PARSED ---\n' + JSON.stringify(parseLabel(data.text)));
}
await worker.terminate();
