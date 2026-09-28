/* ============ SmartDoc — OCR via Tesseract.js (hin + eng) ============ */
import { loadScript, clamp, uid, esc } from './ui.js';

const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let tesseract = null;
let worker = null;
let workerLang = '';

export async function ensureTesseract() {
  if (!tesseract) {
    await loadScript(TESS_URL);
    tesseract = window.Tesseract;
  }
  return tesseract;
}

const STATUS_HI = {
  'loading tesseract core': 'OCR engine download ho raha hai…',
  'initializing tesseract': 'OCR engine initialize ho raha hai…',
  'initialized tesseract': 'OCR engine ready…',
  'loading language traineddata': 'Language data (Hindi+English) download ho raha hai…',
  'loaded language traineddata': 'Language data ready…',
  'initializing api': 'OCR prepare ho raha hai…',
  'initialized api': 'OCR start ho raha hai…',
  'recognizing text': 'Text read ho raha hai (OCR)…',
};

async function getWorker(lang, onLog) {
  const T = await ensureTesseract();
  if (worker && workerLang === lang) return worker;
  if (worker) { try { await worker.terminate(); } catch (e) {} worker = null; }
  worker = await T.createWorker(lang, 1, {
    logger: (m) => {
      if (!onLog) return;
      const msg = STATUS_HI[m.status] || 'OCR processing…';
      onLog({ status: m.status, progress: m.progress ?? 0, msg });
    },
  });
  workerLang = lang;
  return worker;
}

/* Convert Tesseract line data into positioned text spans */
export function spansFromOcr(data) {
  const lines = (data && data.lines) || [];
  const spans = [];
  if (!lines.length) return spans;
  const heights = lines.map(l => (l.bbox ? l.bbox.y1 - l.bbox.y0 : 0)).filter(h => h > 4).sort((a, b) => a - b);
  const med = heights.length ? heights[Math.floor(heights.length / 2)] : 14;
  for (const l of lines) {
    const t = (l.text || '').replace(/\s+/g, ' ').trim();
    if (!t || !l.bbox) continue;
    const { x0, y0, x1, y1 } = l.bbox;
    const h = y1 - y0;
    if (h < 4 || (x1 - x0) < 4) continue;
    const fs = clamp(h / 1.22, 8, 140);
    const words = (l.words || []).filter(w => w.text && w.text.trim());
    const html = words.length
      ? words.map(w => `<span class="tw">${esc(w.text)}</span>`).join(' ')
      : esc(t);
    const conf = l.confidence ?? 70;
    spans.push({
      id: uid(), x: Math.max(0, x0), y: Math.max(0, y0), w: Math.max(24, x1 - x0),
      html, plain: t, fs, font: null, color: '#111827',
      bold: fs > med * 1.32, italic: false, underline: false, strike: false,
      align: 'left', lh: 1.28, ls: 0, bg: '', border: null, shadow: 0, rot: 0,
      lowConf: conf < 62, z: 0,
    });
  }
  return spans;
}

/*
 * Run OCR over pages that need it.
 * pages: array of page objects (with id, w, h) — spans written into page.spans
 * onProgress: (0..1, statusText)
 */
export async function ocrPages(pages, lang, onProgress) {
  const n = pages.length;
  let base = 0;
  let pageIdx = 0;
  const w = await getWorker(lang || 'hin+eng', (m) => {
    if (m.status === 'recognizing text') {
      onProgress(Math.min(0.99, (pageIdx + (m.progress ?? 0)) / n), `Page ${pageIdx + 1} / ${n} — text recognize ho raha hai…`);
      return;
    }
    onProgress(Math.max(0.01, base), m.msg);
  });
  for (let i = 0; i < n; i++) {
    pageIdx = i;
    const p = pages[i];
    onProgress(i / n, `Page ${i + 1} / ${n} — text recognize ho raha hai…`);
    const dataUrl = p._bgUrl; // provided by caller
    const { data } = await w.recognize(dataUrl);
    p.spans = spansFromOcr(data);
    p.ocrDone = true;
    base = (i + 1) / n;
    onProgress(base, `Page ${i + 1} / ${n} complete ✓ (${p.spans.length} text blocks)`);
  }
  try { await w.terminate(); } catch (e) {}
  worker = null; workerLang = '';
  return true;
}
