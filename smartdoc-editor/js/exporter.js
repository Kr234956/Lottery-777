/* ============ SmartDoc — export engine: canvas compositing, PDF, PNG/JPG, ZIP ============ */
import { loadScript, hexToRgb, clamp } from './ui.js';
import { dataUrlToImage } from './importer.js';

const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';

async function ensureJspdf() {
  if (!window.jspdf) await loadScript(JSPDF_URL);
  return window.jspdf.jsPDF;
}
async function ensureJszip() {
  if (!window.JSZip) await loadScript(JSZIP_URL);
  return window.JSZip;
}

/* ---------------- shared vector rendering (also used by live canvas) ---------------- */
export function drawInk(ctx, s, S = 1) {
  ctx.save();
  ctx.globalAlpha = s.opacity ?? 1;
  ctx.strokeStyle = s.color; ctx.fillStyle = s.color;
  let w = (s.width || 2) * S;
  if (s.type === 'marker') { ctx.globalAlpha *= 0.45; w *= 4; }
  else if (s.type === 'highlighter') { ctx.globalAlpha *= 0.42; w *= 6.5; ctx.globalCompositeOperation = 'multiply'; }
  else if (s.type === 'signature') { w = Math.max(w, 1.6 * S); }
  ctx.lineWidth = w;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const pts = (s.pts || []).map(p => [p.x * S, p.y * S]);
  if (s.type === 'line' || s.type === 'arrow') {
    const x1 = s.x1 * S, y1 = s.y1 * S, x2 = s.x2 * S, y2 = s.y2 * S;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    if (s.type === 'arrow') {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const hl = Math.max(11 * S, w * 4.2);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - hl * Math.cos(ang - 0.44), y2 - hl * Math.sin(ang - 0.44));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - hl * Math.cos(ang + 0.44), y2 - hl * Math.sin(ang + 0.44));
      ctx.stroke();
    }
  } else if (s.type === 'rect') {
    const x = Math.min(s.x1, s.x2) * S, y = Math.min(s.y1, s.y2) * S;
    const ww = Math.abs(s.x2 - s.x1) * S, hh = Math.abs(s.y2 - s.y1) * S;
    ctx.strokeRect(x, y, ww, hh);
  } else if (s.type === 'circle') {
    const cx = (s.x1 + s.x2) / 2 * S, cy = (s.y1 + s.y2) / 2 * S;
    const rx = Math.abs(s.x2 - s.x1) / 2 * S, ry = Math.abs(s.y2 - s.y1) / 2 * S;
    ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2); ctx.stroke();
  } else if (pts.length === 1) {
    ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], w / 2, 0, Math.PI * 2); ctx.fill();
  } else if (pts.length > 1) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawFill(ctx, f, S = 1) {
  ctx.save();
  ctx.fillStyle = f.color; ctx.strokeStyle = f.color;
  if (f.kind === 'brush') {
    const pts = f.pts.map(p => [p.x * S, p.y * S]);
    ctx.lineWidth = f.size * S; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], f.size * S / 2, 0, Math.PI * 2); ctx.fill(); }
    else {
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      ctx.stroke();
    }
  } else if (f.kind === 'rect') {
    ctx.fillRect(f.x * S, f.y * S, f.w * S, f.h * S);
  } else if (f.kind === 'poly') {
    ctx.beginPath();
    f.pts.forEach((p, i) => i ? ctx.lineTo(p.x * S, p.y * S) : ctx.moveTo(p.x * S, p.y * S));
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/* ---------------- text span rasterization (foreignObject, with fallback) ---------------- */
async function spanToImage(span, el) {
  const w = Math.max(2, Math.ceil(el.offsetWidth));
  const h = Math.max(2, Math.ceil(el.offsetHeight));
  const clone = el.cloneNode(true);
  clone.className = '';
  clone.removeAttribute('id');
  clone.style.position = 'static';
  clone.style.margin = '0';
  clone.style.boxSizing = 'border-box';
  clone.style.width = w + 'px';
  const styleBlock = '<style>.fxline{white-space:pre-wrap;word-wrap:break-word}.fxline ul,.fxline ol{margin:0;padding-left:1.35em;list-style-position:inside}.fxline sup,.fxline sub{font-size:.72em}</style>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><foreignObject x="0" y="0" width="${w}" height="${h}">${styleBlock}<div xmlns="http://www.w3.org/1999/xhtml" class="fxline">${clone.outerHTML}</div></foreignObject></svg>`;
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res; img.onerror = () => rej(new Error('svg render failed'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  return { img, w, h };
}

function fallbackDrawSpan(ctx, span, S) {
  const lines = (span.plain || span.html || '').split('\n');
  const font = `${span.italic ? 'italic ' : ''}${span.bold ? '700 ' : ''}${span.fs}px ${span.font || 'Arial, sans-serif'}`;
  ctx.font = font;
  ctx.fillStyle = span.color || '#111827';
  const lh = span.fs * (span.lh || 1.28);
  lines.forEach((ln, i) => {
    let x = 0;
    const tw = ctx.measureText(ln).width;
    if (span.align === 'center') x = ((span._w || span.w || tw) - tw) / 2;
    else if (span.align === 'right') x = (span._w || span.w || tw) - tw;
    ctx.fillText(ln, x, i * lh + span.fs * 0.88);
  });
}

async function drawSpanToCtx(ctx, span, el, S) {
  ctx.save();
  const w = Math.max(2, el.offsetWidth), h = Math.max(2, el.offsetHeight);
  const cx = (span.x + w / 2) * S, cy = (span.y + h / 2) * S;
  ctx.translate(cx, cy);
  if (span.rot) ctx.rotate(span.rot * Math.PI / 180);
  try {
    const { img, w: iw, h: ih } = await spanToImage(span, el);
    ctx.drawImage(img, (-iw / 2) * S, (-ih / 2) * S, iw * S, ih * S);
  } catch (e) {
    ctx.translate(-span.x * S, -span.y * S);
    fallbackDrawSpan(ctx, span, S);
  }
  ctx.restore();
}

/* ---------------- full page compositing ---------------- */
const imgCache = new Map();
async function loadLayerImage(src) {
  if (!imgCache.has(src)) imgCache.set(src, dataUrlToImage(src));
  if (imgCache.get(src).catch) { /* keep promise */ }
  const p = imgCache.get(src);
  try { return await p; } catch (e) { imgCache.delete(src); return await dataUrlToImage(src); }
}

export async function compositePage(page, opts) {
  const S = opts.scale || 2;
  const cv = document.createElement('canvas');
  cv.width = Math.max(2, Math.round(page.w * S));
  cv.height = Math.max(2, Math.round(page.h * S));
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cv.width, cv.height);

  // 1) background
  const bg = page._bgImg || (await loadLayerImage(page._bgUrl || ''));
  if (bg && bg.width) ctx.drawImage(bg, 0, 0, cv.width, cv.height);

  // 2) hide original text if reference is off (fill under OCR text bboxes)
  if (opts.showRef === false) {
    const col = page._bgColor || '#ffffff';
    ctx.fillStyle = col;
    for (const s of page.spans) {
      const sw = s._w || s.w || 80, sh = s._h || Math.ceil(s.fs * 1.35);
      ctx.fillRect(s.x - 3, s.y - 2, sw + 6, sh + 4);
    }
  }
  // 3) erase fills
  for (const f of page.fills) drawFill(ctx, f, S);
  // 4) text layers
  if (!opts.skipText) {
    for (const s of page.spans) {
      const el = s._el;
      if (el && el.offsetWidth) await drawSpanToCtx(ctx, s, el, S);
      else {
        ctx.save();
        ctx.translate(s.x * S, s.y * S);
        if (s.rot) ctx.rotate(s.rot * Math.PI / 180);
        fallbackDrawSpan(ctx, s, S);
        ctx.restore();
      }
    }
  }
  // 5) image layers
  for (const im of page.images) {
    let imgEl = null;
    try { imgEl = await loadLayerImage(im.src); } catch (e) { continue; }
    ctx.save();
    ctx.globalAlpha = im.opacity ?? 1;
    const cx = (im.x + im.w / 2) * S, cy = (im.y + im.h / 2) * S;
    ctx.translate(cx, cy);
    ctx.rotate((im.rot || 0) * Math.PI / 180);
    if (im.flipH) ctx.scale(-1, 1);
    if (im.flipV) ctx.scale(1, -1);
    if (im.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 10 * S; ctx.shadowOffsetX = 4 * S; ctx.shadowOffsetY = 4 * S; }
    if (im.shape === 'circle') {
      const r = Math.min(im.w, im.h) * S / 2;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
    }
    ctx.drawImage(imgEl, (-im.w / 2) * S, (-im.h / 2) * S, im.w * S, im.h * S);
    if (im.border) {
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = im.border.c; ctx.lineWidth = im.border.w * S;
      if (im.shape === 'circle') { const r = Math.min(im.w, im.h) * S / 2; ctx.beginPath(); ctx.arc(0, 0, r - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke(); }
      else ctx.strokeRect((-im.w / 2 + im.border.w / 2) * S, (-im.h / 2 + im.border.w / 2) * S, (im.w - im.border.w) * S, (im.h - im.border.w) * S);
    }
    ctx.restore();
  }
  // 6) ink on top
  for (const k of page.ink) drawInk(ctx, k, S);
  return cv;
}

export function canvasToBlob(cv, type, q = 0.92) {
  return new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('canvas toBlob failed')), type, q));
}

/* ---------------- PDF export ---------------- */
const NON_LATIN = /[\u0900-\u097F\u0590-\u05FF\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0E00-\u0E7F]/;

export function pdfFontFor(span) {
  const f = (span.font || '').toLowerCase();
  if (/(times|serif|garamond)/.test(f)) return 'times';
  if (/(courier|mono)/.test(f)) return 'courier';
  return 'helvetica';
}

export async function buildPdf(spec, onProgress) {
  const JSPDF = await ensureJspdf();
  const first = spec.pages[0];
  const doc = new JSPDF({
    unit: 'pt',
    format: [first.ptW, first.ptH],
    orientation: first.ptW > first.ptH ? 'landscape' : 'portrait',
    compress: true,
  });
  spec.pages.forEach((p, i) => {
    if (i > 0) {
      doc.addPage([p.ptW, p.ptH], p.ptW > p.ptH ? 'landscape' : 'portrait');
    }
    if (p.imgDataUrl) doc.addImage(p.imgDataUrl, 'JPEG', 0, 0, p.ptW, p.ptH);
    if (spec.mode === 'edit' && p.page) {
      const page = p.page;
      const ptScale = page.ptH / page.h;
      for (const s of page.spans) {
        const lines = (s.plain || '').split('\n');
        if (!lines.length) continue;
        doc.setFont(pdfFontFor(s), (s.bold ? 'bold' : 'normal') + (s.italic ? 'italic' : ''));
        doc.setFontSize(clamp(s.fs * ptScale, 4, 300));
        const [r, g, b] = hexToRgb(s.color || '#111827');
        doc.setTextColor(r, g, b);
        const lh = s.fs * (s.lh || 1.28) * ptScale;
        const wPt = (s._w || s.w || 200) * ptScale;
        lines.forEach((ln, li) => {
          if (!ln.trim()) return;
          const y = (s.y + s.fs * 0.9 + li * lh) * ptScale;
          let x = s.x * ptScale;
          const align = s.align === 'center' ? 'center' : s.align === 'right' ? 'right' : 'left';
          if (align === 'center') x = (s.x + (s._w || s.w || 200) / 2) * ptScale;
          if (align === 'right') x = (s.x + (s._w || s.w || 200)) * ptScale;
          try { doc.text(ln, x, y, { align, maxWidth: align === 'left' ? wPt : undefined }); }
          catch (e) { doc.text(ln, x, y); }
        });
      }
    }
    if (onProgress) onProgress((i + 1) / spec.pages.length);
  });
  return doc.output('blob');
}

export function hasNonLatin(pages) {
  for (const p of pages) for (const s of p.spans) if (NON_LATIN.test(s.plain || '')) return true;
  return false;
}

/* ---------------- ZIP export ---------------- */
export async function buildZip(files, onProgress) {
  const JSZip = await ensureJszip();
  const zip = new JSZip();
  files.forEach(f => zip.file(f.name, f.blob));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (m) => {
    if (onProgress) onProgress(m.percent / 100);
  });
  return blob;
}
