/* ============ SmartDoc — file import: PDF (pdf.js), images, text extraction ============ */
import { clamp, uid, esc } from './ui.js';

const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
let pdfjsLib = null;

export async function ensurePdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import(PDFJS_URL);
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  return pdfjsLib;
}

/* Guess a web font from a PDF font name */
export function guessFont(fontName) {
  const f = (fontName || '').toLowerCase();
  if (/(courier|mono|consolas|menlo)/.test(f)) return 'Courier New, Courier, monospace';
  if (/(times|romans?|garamond|georgia|palatino|serif)/.test(f)) return 'Times New Roman, Times, serif';
  return 'Arial, Helvetica, sans-serif';
}

/* Build editable text spans from pdf.js textContent items (searchable PDFs) */
export function spansFromPdfText(items, scale) {
  const words = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const [a, , , d, e, f] = it.transform;
    const fs = Math.hypot(a, 0) || Math.abs(d) || 10;
    let x = e * scale;
    const y = f * scale;
    for (const part of it.str.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { x += part.length * fs * 0.52; continue; }
      words.push({ t: part, x, y, fs, bold: /bold|black|heavy|demi|semi|medium/i.test(it.fontName || ''), ital: /italic|oblique/i.test(it.fontName || ''), font: guessFont(it.fontName) });
      x += part.length * fs * 0.52; // rough advance width for gap estimation
    }
  }
  if (!words.length) return [];
  words.sort((p, q) => (q.y - p.y) || (p.x - q.x));
  const lines = [];
  let cur = null;
  for (const w of words) {
    const avgY = cur ? cur.y / cur.n : Infinity;
    if (!cur || Math.abs(w.y - avgY) > (w.fs * 0.55)) {
      cur = { items: [], y: 0, n: 0, fs: 0, x0: Infinity, x1: -Infinity, bold: false, ital: false, font: null };
      lines.push(cur);
    }
    cur.items.push(w); cur.y += w.y; cur.n++;
    cur.fs = Math.max(cur.fs, w.fs);
    cur.x0 = Math.min(cur.x0, w.x);
    cur.x1 = Math.max(cur.x1, w.x + w.t.length * w.fs * 0.52);
    if (w.bold) cur.bold = true; if (w.ital) cur.ital = true;
    if (w.font) cur.font = w.font;
  }
  const spans = [];
  for (const L of lines) {
    const fs = clamp(L.fs, 6, 150);
    const y = L.y / L.n;
    const top = y - fs * 0.88;
    if (top < -4 || fs < 5.5) continue;
    let text = '';
    for (let i = 0; i < L.items.length; i++) {
      const w = L.items[i];
      if (i > 0) {
        const prev = L.items[i - 1];
        const gap = w.x - (prev.x + prev.t.length * prev.fs * 0.52);
        if (gap > prev.fs * 0.18) text += ' ';
      }
      text += w.t;
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const html = text.split(' ').filter(Boolean).map(w => `<span class="tw">${esc(w)}</span>`).join(' ');
    spans.push({
      id: uid(), x: Math.max(0, L.x0), y: Math.max(0, top), w: Math.max(24, L.x1 - L.x0),
      html, plain: text, fs, font: L.font, color: '#111827',
      bold: L.bold, italic: L.ital, underline: false, strike: false,
      align: 'left', lh: 1.28, ls: 0, bg: '', border: null, shadow: 0, rot: 0, lowConf: false, z: 0,
    });
  }
  return spans;
}

/* Render pages of a PDF -> {w,h,ptW,ptH,bg,searchable,textItems} */
export async function importPdf(file, onProgress, maxPages = Infinity) {
  const lib = await ensurePdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: buf }).promise;
  const out = [];
  const limit = Math.min(pdf.numPages, maxPages);
  for (let i = 1; i <= limit; i++) {
    onProgress(i, pdf.numPages);
    const page = await pdf.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const renderScale = clamp(1000 / vp1.width, 0.6, 2.4);
    const vp = page.getViewport({ scale: renderScale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    let textItems = [], searchable = false;
    try {
      const tc = await page.getTextContent();
      textItems = tc.items.filter(it => it.str && it.str.trim());
      searchable = textItems.map(it => it.str).join('').trim().length > 10;
    } catch (e) { /* scanned page — no text layer */ }
    out.push({
      kind: 'pdf', w: canvas.width, h: canvas.height,
      ptW: vp1.width, ptH: vp1.height, bg: dataUrl, searchable, textItems,
      fonts: [...new Set(textItems.map(it => it.fontName || ''))],
    });
  }
  try { await pdf.destroy(); } catch (e) {}
  return out;
}

/* Read an image file -> {w,h,bg,hasAlpha} (downscaled for performance) */
export function imageFileToPage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        let { naturalWidth: w, naturalHeight: h } = img;
        const MAX = 1700;
        let scale = 1;
        if (Math.max(w, h) > MAX) scale = MAX / Math.max(w, h);
        w = Math.max(2, Math.round(w * scale)); h = Math.max(2, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const isPng = /png|webp|svg/.test(file.type);
        const bg = isPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92);
        resolve({ kind: 'image', w, h, bg, hasAlpha: isPng });
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image decode failed')); };
    img.src = url;
  });
}

export function dataUrlToImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/* Blank white page as dataURL */
export function blankPageDataUrl(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  return c.toDataURL('image/png');
}
