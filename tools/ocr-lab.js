// Dev-only page module for OCR experiments and evaluation (tools/ocr-lab.html).
import { createWorker } from 'tesseract.js';
import * as img from '/src/ocr/image.js';
import * as locate from '/src/ocr/locate.js';
import { recognizeLabel } from '/src/ocr/recognize.js';
import { parseLabelLegacy } from '/tools/legacy-parse.js';
window.lab = { img, locate, recognizeLabel, parseLabelLegacy, createWorker, ready: true };
