/* ============================================================
   SmartDoc Editor — main application
   ============================================================ */
import {
  el, esc, icon, toast, clamp, uid, hexToRgb, rgbToHex,
  openMenu, closeMenu, openModal, closeModal, closeAllModals, bindCloseButtons,
} from './ui.js';
import { importPdf, imageFileToPage, spansFromPdfText, blankPageDataUrl, dataUrlToImage, guessFont } from './importer.js';
import { ocrPages } from './ocr.js';
import { compositePage, canvasToBlob, buildPdf, buildZip, hasNonLatin, drawInk, drawFill } from './exporter.js';
import { downloadBlob, shareFile, downloadAndShare, whatsapp, copyLink, emailShare } from './share.js';

const $ = (s) => document.querySelector(s);
const DRAFT_KEY = 'smartdoc.draft.v1';
const MAX_FILE = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 30;
const MAX_IMG_INSERT = 20 * 1024 * 1024;

/* ---------------- state ---------------- */
export const state = {
  pages: [], cur: 0, zoom: 1, fit: true,
  tool: 'select', eraserMode: 'brush', inkTool: 'pen',
  ink: { color: '#dc2626', width: 3, opacity: 1 },
  brushSize: 24,
  showRef: true, preview: false,
  sel: null, dirty: false,
  sourceType: null, sourceExt: '', baseName: 'document',
  ocrLang: 'hin+eng',
  lastExport: null,
};
const bgStore = new Map();      // pageId -> bg dataURL
const bgImgs = new Map();       // pageId -> Promise<HTMLImageElement>
const bgCvs = new Map();        // pageId -> sampling canvas
const history = { undo: [], redo: [] };
let clip = null;                // internal clipboard {type, data}
let spaceDown = false;
let editTimer = null;
let lassoPts = null;            // active lasso points (page px)
let lassoCv = null;

const curPage = () => state.pages[state.cur];

/* ---------------- history ---------------- */
function snapshot() {
  return JSON.stringify({ pages: state.pages, cur: state.cur });
}
function pushHistory(pre) {
  history.undo.push(pre);
  if (history.undo.length > 40) history.undo.shift();
  history.redo.length = 0;
  state.dirty = true;
  updateChrome();
  scheduleAutosave();
}
function commit() { // call BEFORE applying a change
  const pre = snapshot();
  return pre;
}
function restore(snap) {
  const s = typeof snap === 'string' ? JSON.parse(snap) : snap;
  state.pages = s.pages; state.cur = s.cur; state.sel = null;
  state.dirty = true;
  renderAll();
  scheduleAutosave();
}
function undo() {
  if (!state.pages.length) return;
  if (!history.undo.length) { toast('Undo ke liye kuch nahi hai', 'info', 1800); return; }
  history.redo.push(snapshot());
  restore(history.undo.pop());
  updateChrome();
}
function redo() {
  if (!state.pages.length) return;
  if (!history.redo.length) { toast('Redo ke liye kuch nahi hai', 'info', 1800); return; }
  history.undo.push(snapshot());
  restore(history.redo.pop());
  updateChrome();
}

/* ---------------- drafts / autosave ---------------- */
let saveTimer = null, quotaWarned = false;
function draftJSON() {
  return JSON.stringify({
    ts: Date.now(), baseName: state.baseName, sourceType: state.sourceType,
    showRef: state.showRef, ocrLang: state.ocrLang,
    pages: state.pages.map(p => ({ ...p, bg: bgStore.get(p.id) || null })),
  });
}
function scheduleAutosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 2500);
}
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, draftJSON()); }
  catch (e) {
    if (!quotaWarned) {
      quotaWarned = true;
      toast('Browser storage limit — "Save project" se project file me save karein', 'warn', 5000);
    }
  }
}
function loadDraftMeta() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    return d || null;
  } catch (e) { return null; }
}
function restoreDraft() {
  const d = loadDraftMeta();
  if (!d) return toast('Draft nahi mila', 'error');
  try {
    state.baseName = d.baseName || 'document';
    state.sourceType = d.sourceType;
    state.showRef = d.showRef !== false;
    state.ocrLang = d.ocrLang || 'hin+eng';
    state.pages = (d.pages || []).map(p => {
      if (p.bg) bgStore.set(p.id, p.bg);
      delete p.bg;
      return p;
    });
    state.cur = 0; state.sel = null; state.dirty = true;
    history.undo.length = 0; history.redo.length = 0;
    enterApp();
    renderAll();
    fitZoom();
    toast('Draft restore ho gaya — editing continue karein', 'success', 3500);
  } catch (e) {
    toast('Draft load nahi ho saka — corrupted file', 'error');
  }
}
function discardDraft() {
  localStorage.removeItem(DRAFT_KEY);
  const c = $('#draftCard'); if (c) c.classList.add('hidden');
  toast('Draft discard ho gaya', 'info', 2000);
}
function saveProjectFile() {
  if (!state.pages.length) return;
  const blob = new Blob([draftJSON()], { type: 'application/json' });
  downloadBlob(blob, `${state.baseName}-project.json`);
}

/* ---------------- upload pipeline ---------------- */
async function handleFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  const accepted = [];
  for (const f of files) {
    if (f.size > MAX_FILE) { toast(`File bahut large hai: ${f.name} (max 50MB)`, 'error', 4200); continue; }
    if (f.type === 'application/pdf') accepted.push({ f, kind: 'pdf' });
    else if (/^image\/(png|jpe?g|webp|svg\+xml)$/i.test(f.type)) accepted.push({ f, kind: 'image' });
    else toast(`File format supported nahi hai: ${f.name}`, 'error', 4200);
  }
  if (!accepted.length) return;

  showOcr('Files load ho rahi hain…', 0, 'Start ho raha hai…');
  const newPages = [];
  let totalPdfPages = 0;
  for (const { f, kind } of accepted) {
    try {
      if (kind === 'pdf') {
        const pages = await importPdf(f, (i, n) => setOcr((i / n) * 0.5, `PDF ka page ${i} / ${n} render ho raha hai…`), MAX_PDF_PAGES);
        if (pages.length >= MAX_PDF_PAGES) {
          toast(`File bahut large hai — sirf pehle ${MAX_PDF_PAGES} pages import hue`, 'warn', 5000);
        }
        totalPdfPages += pages.length;
        for (const p of pages) {
          const id = uid();
          const page = makePage(id, 'pdf', p);
          if (p.searchable) {
            const scale = p.w / p.ptW;
            page.spans = spansFromPdfText(p.textItems, scale);
            if (!page.spans.length) page.needsOcr = true;
          } else {
            page.needsOcr = true;
            page.scanned = true;
          }
          if (page.spans && page.spans.length && p.fonts && p.fonts.length) {
            page.font = guessFont(p.fonts[0]);
          }
          newPages.push(page);
        }
      } else {
        const d = await imageFileToPage(f);
        const id = uid();
        const page = makePage(id, 'image', d);
        page.needsOcr = true;
        newPages.push(page);
      }
    } catch (e) {
      console.error(e);
      toast('File process karte waqt error aaya — dobara try karein', 'error', 4500);
    }
  }
  if (!newPages.length) { hideOcr(); return; }

  // OCR phase for scanned pages
  const ocrList = newPages.filter(p => p.needsOcr);
  if (ocrList.length) {
    setOcr(0.55, 'OCR engine taiyaar ho raha hai…');
    try {
      for (const p of ocrList) p._bgUrl = bgStore.get(p.id);
      await ocrPages(ocrList, state.ocrLang, (frac, msg) => setOcr(0.55 + frac * 0.43, msg));
      const lowConf = ocrList.flatMap(p => p.spans.filter(s => s.lowConf)).length;
      if (lowConf) setTimeout(() => toast(`${lowConf} text blocks ki confidence kam hai (orange border) — click karke manually correct karein`, 'warn', 6000), 400);
    } catch (e) {
      console.error(e);
      toast('OCR processing failed — Internet connection check karein. Pages editable canvas par khule hain (text add kar sakte hain).', 'error', 7000);
    }
  }
  setOcr(1, 'Document ready ho raha hai…');

  const existed = state.pages.length;
  state.pages = state.pages.concat(newPages);
  if (!existed) {
    state.sourceType = newPages[0].kind === 'pdf' ? 'pdf' : 'image';
    state.sourceExt = ((accepted[0] && accepted[0].f.name) || '').split('.').pop().toLowerCase();
    state.baseName = baseFrom(accepted[0] && accepted[0].f.name ? accepted[0].f.name : 'document');
  }
  state.cur = existed;
  state.sel = null; state.dirty = true;
  hideOcr();
  enterApp();
  renderAll();
  fitZoom();
  updateChrome();
  const scanned = newPages.filter(p => p.needsOcr).length;
  toast(`Document ready! ${state.pages.length} page(s) — kisi bhi text par click karke edit karein${scanned ? ` (${scanned} pages OCR hue)` : ''}`, 'success', 5000);
}

function baseFrom(name) {
  return (name || 'document').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'document';
}

function makePage(id, kind, d) {
  const page = {
    id, kind,
    w: d.w, h: d.h,
    ptW: d.ptW || d.w * 0.75, ptH: d.ptH || d.h * 0.75,
    font: 'Arial, Helvetica, sans-serif',
    spans: [], images: [], fills: [], ink: [],
    rot90: 0,
  };
  bgStore.set(id, d.bg);
  return page;
}

/* ---------------- OCR overlay ---------------- */
function showOcr(title, pct, status) {
  $('#ocrOverlay').classList.remove('hidden');
  if (title) $('#ocrTitle').textContent = title;
  setOcr(pct, status);
}
function setOcr(pct, status) {
  $('#ocrBarFill').style.width = clamp(pct * 100, 0, 100) + '%';
  $('#ocrPct').textContent = Math.round(clamp(pct, 0, 1) * 100) + '%';
  if (status) $('#ocrStatus').textContent = status;
}
function hideOcr() { $('#ocrOverlay').classList.add('hidden'); }

/* ---------------- app / landing switch ---------------- */
function enterApp() {
  $('#landing').classList.add('hidden');
  $('#app').classList.remove('hidden');
}

/* ---------------- page bg image / sampling ---------------- */
function getBgImg(page) {
  if (bgImgs.has(page.id)) return bgImgs.get(page.id);
  if (bgImgs.size > 12) {
    for (const id of [...bgImgs.keys()]) {
      if (id !== page.id && (!curPage() || curPage().id !== id)) { bgImgs.delete(id); break; }
    }
  }
  const img = new Image();
  const p = new Promise((res) => {
    img.onload = () => {
      page._bgImg = img;
      if (!page._bgColor) page._bgColor = pageBgColor(page);
      res(img);
    };
    img.onerror = () => res(img);
    img.src = bgStore.get(page.id) || '';
  });
  bgImgs.set(page.id, p);
  return p;
}
/* small (160px wide) canvas used only for background color sampling — keeps memory low */
function getBgCv(page) {
  if (bgCvs.has(page.id)) return bgCvs.get(page.id);
  const img = page._bgImg;
  if (!img || !img.width) return null;
  const cv = document.createElement('canvas');
  cv.width = 160; cv.height = Math.max(2, Math.round(160 * page.h / page.w));
  cv.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, cv.width, cv.height);
  bgCvs.set(page.id, cv);
  return cv;
}
function sampleBgColor(page, x, y) {
  const cv = getBgCv(page);
  if (!cv) return page._bgColor || '#ffffff';
  const ctx = cv.getContext('2d');
  const k = cv.width / page.w;
  const W = Math.min(cv.width, Math.max(8, Math.round(56 * k))), H = Math.min(cv.height, Math.max(8, Math.round(56 * k)));
  const sx = clamp(Math.round(x * k - W / 2), 0, Math.max(0, cv.width - W));
  const sy = clamp(Math.round(y * k - H / 2), 0, Math.max(0, cv.height - H));
  const d = ctx.getImageData(sx, sy, W, H).data;
  const counts = {};
  for (let i = 0; i < d.length; i += 16) { // sample every 4th pixel
    const k = (d[i] >> 5) + '-' + (d[i + 1] >> 5) + '-' + (d[i + 2] >> 5);
    const c = (counts[k] ||= { n: 0, r: 0, g: 0, b: 0 });
    c.n++; c.r += d[i]; c.g += d[i + 1]; c.b += d[i + 2];
  }
  let best = null;
  for (const k in counts) if (!best || counts[k].n > best.n) best = counts[k];
  return best ? rgbToHex(best.r / best.n, best.g / best.n, best.b / best.n) : (page._bgColor || '#ffffff');
}
function pageBgColor(page) {
  const cv = getBgCv(page);
  if (!cv) return '#ffffff';
  const ctx = cv.getContext('2d');
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const counts = {};
  for (let i = 0; i < d.length; i += 4) {
    const k = (d[i] >> 5) + '-' + (d[i + 1] >> 5) + '-' + (d[i + 2] >> 5);
    const c = (counts[k] ||= { n: 0, r: 0, g: 0, b: 0 });
    c.n++; c.r += d[i]; c.g += d[i + 1]; c.b += d[i + 2];
  }
  let best = null;
  for (const k in counts) if (!best || counts[k].n > best.n) best = counts[k];
  return best ? rgbToHex(best.r / best.n, best.g / best.n, best.b / best.n) : '#ffffff';
}

/* ---------------- page rendering ---------------- */
function renderAll() {
  renderCurrentPage();
  renderThumbs();
  renderProps();
  updatePageIndicator();
  updateChrome();
}
function buildPageWrap(p) {
  const wrap = el(`<div class="page-wrap" data-idx="${state.cur}"></div>`);
  const sheet = el(`<div class="sheet"></div>`);
  sheet.style.width = p.w + 'px';
  sheet.style.height = p.h + 'px';
  const bg = el('<img class="page-bg" alt="Page background (reference)" draggable="false">');
  bg.src = bgStore.get(p.id) || '';
  const fillCv = el('<canvas class="fill-canvas"></canvas>');
  fillCv.width = p.w; fillCv.height = p.h;
  const textL = el('<div class="layer layer-text"></div>');
  const imgL = el('<div class="layer layer-img"></div>');
  const inkCv = el('<canvas class="ink-canvas"></canvas>');
  inkCv.width = p.w; inkCv.height = p.h;
  sheet.append(bg, fillCv, textL, imgL, inkCv);
  wrap.appendChild(sheet);
  p._el = { wrap, sheet, bg, fillCv, textL, imgL, inkCv, gizmo: null };
  attachSheetEvents(p);
  return wrap;
}
function mountContent(p) {
  const e = p._el;
  e.textL.innerHTML = ''; e.imgL.innerHTML = '';
  rebuildSpans(p);
  rebuildImages(p);
  e.fillCv.width = p.w; e.fillCv.height = p.h;
  e.inkCv.width = p.w; e.inkCv.height = p.h;
  redrawFills(p);
  redrawInk(p);
  getBgImg(p);
}
function renderCurrentPage() {
  const area = $('#pagesArea');
  area.innerHTML = '';
  const p = curPage();
  if (!p) return;
  buildPageWrap(p);
  mountContent(p);
  applySheetScale(p);
  area.appendChild(p._el.wrap);
  $('#canvasScroll').scrollTop = 0;
  $('#canvasScroll').scrollLeft = 0;
}
function rebuildSpans(p) {
  const L = p._el.textL;
  L.innerHTML = '';
  for (const o of p.spans) {
    const d = el(`<div class="td-span" data-id="${o.id}" data-kind="text" tabindex="-1"></div>`);
    d.innerHTML = o.html;
    if (o.lowConf) d.classList.add('low-conf');
    L.appendChild(d);
    o._el = d;
    applySpanStyle(o);
  }
  updateMeasurements(p);
}
function rebuildImages(p) {
  const L = p._el.imgL;
  L.innerHTML = '';
  for (const o of p.images) {
    const d = el(`<div class="td-img ${o.shape === 'circle' ? 'circle' : ''}" data-id="${o.id}" data-kind="image"></div>`);
    d.innerHTML = `<img src="${o.src}" alt="${esc(o.name || 'image')}" draggable="false">`;
    L.appendChild(d);
    o._el = d;
    applyImgStyle(o);
  }
}
function updateMeasurements(p) {
  for (const o of p.spans) {
    if (o._el) { o._w = o._el.offsetWidth; o._h = o._el.offsetHeight; }
  }
}
function redrawFills(p) {
  const cv = p._el.fillCv;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, p.w, p.h);
  if (!state.showRef) {
    const col = p._bgColor || '#ffffff';
    ctx.fillStyle = col;
    for (const s of p.spans) {
      const sw = s._w || s.w || 80, sh = s._h || Math.ceil(s.fs * 1.35);
      ctx.fillRect(s.x - 3, s.y - 2, sw + 6, sh + 4);
    }
  }
  for (const f of p.fills) drawFill(ctx, f, 1);
}
function redrawInk(p) {
  const cv = p._el.inkCv;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, p.w, p.h);
  for (const k of p.ink) drawInk(ctx, k, 1);
}

/* ---------------- zoom ---------------- */
function setZoom(z) {
  state.zoom = clamp(z, 0.2, 4);
  state.fit = false;
  const p = curPage();
  if (p) applySheetScale(p);
  updateZoomUI();
}
function applySheetScale(p) {
  const e = p._el;
  if (!e) return;
  const z = state.zoom;
  e.sheet.style.transform = `scale(${z})`;
  e.wrap.style.width = (p.w * z) + 'px';
  e.wrap.style.height = (p.h * z) + 'px';
  e.sheet.style.setProperty('--hz', (9 / z) + 'px');
  e.sheet.style.setProperty('--gbd', (1.5 / z) + 'px');
  e.sheet.style.setProperty('--hrot', (12 / z) + 'px');
  e.sheet.style.setProperty('--grot', (-30 / z) + 'px');
  e.sheet.style.setProperty('--gline', (-15 / z) + 'px');
}
function fitZoom() {
  const p = curPage();
  if (!p) return;
  const vw = $('#canvasScroll').clientWidth - 60;
  const vh = $('#canvasScroll').clientHeight - 60;
  state.zoom = clamp(Math.min(vw / p.w, vh / p.h), 0.2, 4);
  state.fit = true;
  applySheetScale(p);
  updateZoomUI();
}
function updateZoomUI() {
  const elp = $('#zoomPct');
  if (elp) elp.textContent = Math.round(state.zoom * 100) + '%';
}
function goPage(i) {
  if (i < 0 || i >= state.pages.length) return;
  state.cur = i;
  state.sel = null;
  lassoClear();
  renderAll();
}

/* ---------------- text span styling ---------------- */
function applySpanStyle(o) {
  const s = o._el.style;
  const page = curPage() || {};
  s.position = 'absolute';
  s.left = o.x + 'px'; s.top = o.y + 'px';
  s.width = o.w ? o.w + 'px' : 'auto';
  s.maxWidth = 'none';
  s.fontSize = o.fs + 'px';
  s.fontFamily = o.font || page.font || 'Arial, Helvetica, sans-serif';
  s.color = o.color || '#111827';
  s.fontWeight = o.bold ? '700' : '400';
  s.fontStyle = o.italic ? 'italic' : 'normal';
  const deco = [];
  if (o.underline) deco.push('underline');
  if (o.strike) deco.push('line-through');
  s.textDecoration = deco.join(' ') || 'none';
  s.textAlign = o.align || 'left';
  s.lineHeight = String(o.lh || 1.28);
  s.letterSpacing = (o.ls || 0) + 'px';
  s.backgroundColor = o.bg || 'transparent';
  s.border = o.border ? `${o.border.w}px solid ${o.border.c}` : '1px solid transparent';
  s.padding = o.border ? '3px 6px' : '1px 2px';
  s.boxShadow = o.shadow ? `0 ${Math.max(1, o.shadow / 2)}px ${o.shadow}px rgba(0,0,0,${o.shadowO || 0.38})` : 'none';
  s.textShadow = o.tshadow ? `${o.tshadow}px ${o.tshadow}px ${Math.round(o.tshadow * 1.5)}px rgba(0,0,0,${o.tshadowO || 0.35})` : 'none';
  s.transform = o.rot ? `rotate(${o.rot}deg)` : 'none';
  s.whiteSpace = 'pre-wrap';
  s.overflowWrap = 'break-word';
  s.wordWrap = 'break-word';
}
function applyImgStyle(o) {
  if (!o._el) return;
  const s = o._el.style;
  s.left = o.x + 'px'; s.top = o.y + 'px';
  s.width = o.w + 'px'; s.height = o.h + 'px';
  s.opacity = String(o.opacity ?? 1);
  const tf = [`rotate(${o.rot || 0}deg)`];
  if (o.flipH) tf.push('scaleX(-1)');
  if (o.flipV) tf.push('scaleY(-1)');
  s.transform = tf.join(' ');
  s.border = o.border ? `${o.border.w}px solid ${o.border.c}` : 'none';
  s.boxShadow = o.shadow ? '4px 4px 12px rgba(0,0,0,0.4)' : 'none';
  o._el.classList.toggle('circle', o.shape === 'circle');
}
function applyPos(o) {
  if (!o._el) return;
  o._el.style.left = o.x + 'px';
  o._el.style.top = o.y + 'px';
}

/* ---------------- selection & gizmo ---------------- */
function select(type, id) {
  state.sel = (type && id) ? { type, id } : null;
  const p = curPage();
  refreshSelectionUI(p);
  renderProps();
  updateChrome();
}
function selObj() {
  const s = state.sel;
  if (!s) return null;
  const p = curPage();
  if (!p) return null;
  const arr = s.type === 'text' ? p.spans : p.images;
  return arr.find(o => o.id === s.id) || null;
}
function refreshSelectionUI(p) {
  if (!p || !p._el) return;
  if (p._el.gizmo) { p._el.gizmo.remove(); p._el.gizmo = null; }
  p._el.textL.querySelectorAll('.td-span.selected').forEach(e => e.classList.remove('selected'));
  p._el.imgL.querySelectorAll('.td-img.selected').forEach(e => e.classList.remove('selected'));
  const o = selObj();
  if (!o || !o._el) return;
  o._el.classList.add('selected');
  const w = o._el.offsetWidth, h = o._el.offsetHeight;
  const g = el(`<div class="gizmo"><div class="gbox"></div>
    <div class="gz nw" data-h="nw"></div><div class="gz n" data-h="n"></div><div class="gz ne" data-h="ne"></div>
    <div class="gz e" data-h="e"></div><div class="gz se" data-h="se"></div><div class="gz s" data-h="s"></div>
    <div class="gz sw" data-h="sw"></div><div class="gz w" data-h="w"></div>
    <div class="gz-rot-line"></div><div class="gz-rot" title="Rotate (Shift se free angle)"></div></div>`);
  g.style.left = o.x + 'px';
  g.style.top = o.y + 'px';
  g.style.width = w + 'px';
  g.style.height = h + 'px';
  if (o.rot) { g.style.transform = `rotate(${o.rot}deg)`; g.style.transformOrigin = 'center'; }
  p._el.sheet.appendChild(g);
  p._el.gizmo = g;
}
function updateGizmo(o) {
  const p = curPage();
  if (!p || !p._el) return;
  const g = p._el.gizmo;
  if (g) {
    g.style.left = o.x + 'px';
    g.style.top = o.y + 'px';
    g.style.width = o._el.offsetWidth + 'px';
    g.style.height = o._el.offsetHeight + 'px';
  }
}

/* ============================================================
   PART B — interactions, tools, panels, pages, export
   ============================================================ */

/* ---------------- coordinate helpers ---------------- */
function toPage(e, p) {
  const r = p._el.sheet.getBoundingClientRect();
  return { x: (e.clientX - r.left) / state.zoom, y: (e.clientY - r.top) / state.zoom };
}
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/* ---------------- sheet events ---------------- */
function attachSheetEvents(p) {
  const sheet = p._el.sheet;
  sheet.addEventListener('pointerdown', onSheetDown);
  sheet.addEventListener('dblclick', (e) => {
    if (state.preview) return;
    if (state.tool === 'erase' && state.eraserMode === 'lasso') { lassoFinish(); return; }
    const sp = e.target.closest('.td-span');
    if (sp && state.tool === 'select') {
      const o = p.spans.find(s => s.id === sp.dataset.id);
      if (o) { select('text', o.id); startEdit(o); }
    }
  });
  sheet.addEventListener('focusout', (e) => {
    const sp = e.target.closest ? e.target.closest('.td-span.editing') : null;
    if (sp) {
      const o = p.spans.find(s => s.id === sp.dataset.id);
      if (o) setTimeout(() => endEdit(o), 0);
    }
  });
}

/* ---------------- gesture engine ---------------- */
const gesture = { type: null, page: null, pre: null, start: null, obj: null, handle: null, stroke: null, prev: null, moved: false, sx: 0, sy: 0, sl: 0, st: 0, tapDeselect: true };
const scrollEl = () => $('#canvasScroll');
const ptMap = new Map();

function capture(e, p) { try { p._el.sheet.setPointerCapture(e.pointerId); } catch (err) {} }
function cancelGesture() {
  if (gesture.type === 'erase-rect') gesture.prev && gesture.prev.remove();
  gesture.type = null;
}
function movedFar(x, y, dx = 4) { return Math.hypot(x - gesture.sx, y - gesture.sy) > dx; }

function onSheetDown(e) {
  if (state.preview) return;
  if (gesture.type === 'pinch') return;
  const p = curPage();
  if (!p || !p._el) return;
  if (e.button === 2) return;
  const pt = toPage(e, p);
  const t = state.tool;

  if (t === 'text') {
    e.preventDefault();
    const sp = e.target.closest('.td-span');
    if (sp) { select('text', sp.dataset.id); }
    else createTextAt(pt.x, pt.y);
    return;
  }
  if (t === 'erase') {
    e.preventDefault();
    startErase(e, p, pt.x, pt.y);
    return;
  }
  if (t === 'ink') {
    e.preventDefault();
    startInk(e, p, pt.x, pt.y);
    return;
  }

  // select tool
  if (spaceDown || e.button === 1) { startPan(e, true); return; }
  const gEl = e.target.closest('.gz, .gz-rot');
  if (gEl && p._el.gizmo) {
    e.preventDefault();
    const o = selObj();
    if (!o) return;
    if (gEl.classList.contains('gz-rot')) startRotate(e, p, o, pt.x, pt.y);
    else startResize(e, p, o, gEl.dataset.h, pt.x, pt.y);
    return;
  }
  const spanEl = e.target.closest('.td-span');
  const imgEl = e.target.closest('.td-img');
  if (spanEl || imgEl) {
    const kind = spanEl ? 'text' : 'image';
    const id = spanEl ? spanEl.dataset.id : imgEl.dataset.id;
    const obj = (kind === 'text' ? p.spans : p.images).find(s => s.id === id);
    if (obj && obj._editing) return; // let caret/selection happen inside the editor
    e.preventDefault();
    const now = Date.now();
    if (state.sel && state.sel.id === id && kind === 'text') {
      if (editTimer && editTimer.id === id && now - editTimer.t < 450) {
        const o = p.spans.find(s => s.id === id);
        if (o && !o._editing) { startEdit(o); return; }
      }
      editTimer = { id, t: now };
    }
    select(kind, id);
    startMove(e, p, pt.x, pt.y);
    return;
  }
  startPan(e, true);
}

function startPan(e, tapDeselect) {
  const p = curPage();
  if (!p) return;
  gesture.type = 'pan';
  gesture.page = p;
  gesture.sx = e.clientX; gesture.sy = e.clientY;
  gesture.sl = scrollEl().scrollLeft; gesture.st = scrollEl().scrollTop;
  gesture.moved = false;
  gesture.tapDeselect = tapDeselect;
  p._el.sheet.classList.add('panning');
  capture(e, p);
}
function startMove(e, p, x, y) {
  const o = selObj();
  if (!o) return;
  endEditIfAny();
  gesture.type = 'move'; gesture.page = p; gesture.obj = o;
  gesture.pre = commit();
  gesture.sx = x; gesture.sy = y;
  gesture.start = { ox: o.x, oy: o.y };
  gesture.moved = false;
  capture(e, p);
}
function startResize(e, p, o, handle, x, y) {
  endEditIfAny();
  gesture.type = 'resize'; gesture.page = p; gesture.obj = o; gesture.handle = handle;
  gesture.pre = commit();
  gesture.sx = x; gesture.sy = y;
  gesture.start = {
    ox: o.x, oy: o.y,
    ow: o.w || o._el.offsetWidth || 100,
    oh: o._el.offsetHeight || (o.fs * 1.4),
    ofs: o.fs || 16,
  };
  gesture.moved = false;
  capture(e, p);
}
function startRotate(e, p, o, x, y) {
  endEditIfAny();
  const w = o._el.offsetWidth, h = o._el.offsetHeight;
  const cx = o.x + w / 2, cy = o.y + h / 2;
  gesture.type = 'rotate'; gesture.page = p; gesture.obj = o;
  gesture.pre = commit();
  gesture.start = { rot: o.rot || 0, ang: Math.atan2(y - cy, x - cx), cx, cy };
  gesture.moved = false;
  capture(e, p);
}

function onWindowPointerMove(e) {
  if (ptMap.has(e.pointerId)) ptMap.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const g = gesture;
  if (!g.type || !g.page) return;
  const p = g.page;
  const pt = p._el ? toPage(e, p) : { x: 0, y: 0 };

  if (g.type === 'pinch') {
    if (ptMap.size < 2) return;
    const [a, b] = [...ptMap.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const z2 = clamp(g.start.zoom * dist / g.start.dist, 0.2, 4);
    setZoom(z2);
    const r = p._el.sheet.getBoundingClientRect();
    scrollEl().scrollLeft = g.start.sl + (mx - (r.left + g.start.px * z2));
    scrollEl().scrollTop = g.start.st + (my - (r.top + g.start.py * z2));
    return;
  }
  if (g.type === 'pan') {
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
    if (Math.hypot(dx, dy) > 4) g.moved = true;
    if (g.moved) {
      scrollEl().scrollLeft = g.sl - dx;
      scrollEl().scrollTop = g.st - dy;
    }
    return;
  }
  if (g.type === 'move') {
    const dx = pt.x - g.sx, dy = pt.y - g.sy;
    if (Math.hypot(dx, dy) > 1.5) g.moved = true;
    g.obj.x = g.start.ox + dx;
    g.obj.y = g.start.oy + dy;
    applyPos(g.obj);
    updateGizmo(g.obj);
    return;
  }
  if (g.type === 'resize') {
    const o = g.obj, s = g.start, h = g.handle;
    const dx = pt.x - g.sx, dy = pt.y - g.sy;
    if (Math.hypot(dx, dy) > 1.5) g.moved = true;
    if (state.sel.type === 'text') {
      if (h.includes('e')) o.w = clamp(s.ow + dx, 30, 3000);
      if (h.includes('w')) { o.w = clamp(s.ow - dx, 30, 3000); o.x = s.ox + (s.ow - o.w); }
      if (h === 'n' || h === 's' || h === 'ne' || h === 'nw' || h === 'se' || h === 'sw') {
        const nh = h[0] === 'n' ? s.oh - dy : s.oh + dy;
        o.fs = clamp(s.ofs * (nh / s.oh), 6, 300);
      }
      applySpanStyle(o);
    } else {
      const ratio = s.ow / Math.max(1, s.oh);
      let nw = s.ow, nh = s.oh, nx = s.ox, ny = s.oy;
      if (h.includes('e')) nw = clamp(s.ow + dx, 16, 6000);
      if (h.includes('w')) { nw = clamp(s.ow - dx, 16, 6000); nx = s.ox + (s.ow - nw); }
      if (h.includes('s')) nh = clamp(s.oh + dy, 16, 6000);
      if (h.includes('n')) { nh = clamp(s.oh - dy, 16, 6000); ny = s.oy + (s.oh - nh); }
      if (o.lockAspect || e.shiftKey) {
        if (h === 'n' || h === 's') nw = nh * ratio; else nh = nw / ratio;
        if (h.includes('n')) ny = s.oy + (s.oh - nh);
        if (h.includes('w')) nx = s.ox + (s.ow - nw);
      }
      o.w = nw; o.h = nh; o.x = nx; o.y = ny;
      applyImgStyle(o);
    }
    updateGizmo(o);
    return;
  }
  if (g.type === 'rotate') {
    const ang = Math.atan2(pt.y - g.start.cy, pt.x - g.start.cx);
    let deg = g.start.rot + (ang - g.start.ang) * 180 / Math.PI;
    if (!e.shiftKey) {
      const near = Math.round(deg / 90) * 90;
      if (Math.abs(deg - near) < 6) deg = near;
    }
    deg = ((deg % 360) + 360) % 360;
    g.moved = true;
    g.obj.rot = deg;
    if (state.sel.type === 'text') applySpanStyle(g.obj); else applyImgStyle(g.obj);
    updateGizmo(g.obj);
    return;
  }
  if (g.type === 'ink') {
    const s = g.stroke;
    if (s.pts) {
      const last = s.pts[s.pts.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) > 1.2) { s.pts.push({ x: pt.x, y: pt.y }); g.moved = true; }
    } else {
      s.x2 = pt.x; s.y2 = pt.y;
      if (Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 3) g.moved = true;
    }
    redrawInk(p);
    return;
  }
  if (g.type === 'erase-brush') {
    const s = g.stroke;
    const last = s.pts[s.pts.length - 1];
    if (Math.hypot(pt.x - last.x, pt.y - last.y) > 1) { s.pts.push({ x: pt.x, y: pt.y }); g.moved = true; }
    redrawFills(p);
    return;
  }
  if (g.type === 'erase-rect') {
    g.x = pt.x; g.y = pt.y;
    const x = Math.min(g.start.x, pt.x), y = Math.min(g.start.y, pt.y);
    const w = Math.abs(pt.x - g.start.x), h = Math.abs(pt.y - g.start.y);
    g.prev.style.left = x + 'px'; g.prev.style.top = y + 'px';
    g.prev.style.width = w + 'px'; g.prev.style.height = h + 'px';
  }
}

function endGesture() {
  const g = gesture;
  if (!g.type || !g.page) { gesture.type = null; return; }
  const p = g.page;
  if (g.type === 'move') {
    if (g.moved) pushHistory(g.pre);
    refreshSelectionUI(p); renderProps();
  } else if (g.type === 'resize') {
    if (g.moved) {
      pushHistory(g.pre);
      updateMeasurements(p);
      redrawFills(p);
    }
    refreshSelectionUI(p); renderProps();
  } else if (g.type === 'rotate') {
    if (g.moved) pushHistory(g.pre);
    refreshSelectionUI(p); renderProps();
  } else if (g.type === 'ink') {
    const s = g.stroke;
    const tiny = s.pts ? s.pts.length < 2 : (Math.abs(s.x2 - s.x1) < 3 && Math.abs(s.y2 - s.y1) < 3);
    if (tiny) p.ink.pop();
    else pushHistory(g.pre);
    redrawInk(p);
  } else if (g.type === 'erase-brush') {
    if (g.moved) {
      eraseCoveredSpans(p, { kind: 'brush', pts: g.stroke.pts, size: g.stroke.size });
      pushHistory(g.pre);
    }
    redrawFills(p);
  } else if (g.type === 'erase-rect') {
    g.prev && g.prev.remove();
    const x = Math.min(g.start.x, g.x ?? g.start.x), y = Math.min(g.start.y, g.y ?? g.start.y);
    const w = Math.abs((g.x ?? g.start.x) - g.start.x), h = Math.abs((g.y ?? g.start.y) - g.start.y);
    if (w > 4 && h > 4) {
      p.fills.push({ kind: 'rect', x, y, w, h, color: sampleBgColor(p, x + w / 2, Math.max(0, y - 12)) });
      eraseCoveredSpans(p, { kind: 'rect', x, y, w, h });
      pushHistory(g.pre);
    }
    redrawFills(p);
  } else if (g.type === 'pan') {
    if (!g.moved && g.tapDeselect) select(null);
    p._el && p._el.sheet.classList.remove('panning');
  }
  gesture.type = null;
}

/* remove text spans covered by an erase action (brush/rect/poly) */
function eraseCoveredSpans(p, area) {
  let removed = 0;
  p.spans = p.spans.filter(s => {
    const sw = s._w || s.w || 60, sh = s._h || s.fs * 1.4;
    const cx = s.x + sw / 2, cy = s.y + sh / 2;
    let hit = false;
    if (area.kind === 'rect') hit = cx >= area.x && cx <= area.x + area.w && cy >= area.y && cy <= area.y + area.h;
    else if (area.kind === 'brush') {
      const R = (area.size || 20) / 2 + 4;
      hit = area.pts.some(pt => Math.abs(pt.x - cx) < sw / 2 + R && Math.abs(pt.y - cy) < sh / 2 + R);
    } else if (area.kind === 'poly') hit = pointInPoly({ x: cx, y: cy }, area.pts);
    if (hit) removed++;
    return !hit;
  });
  if (removed && p._el) rebuildSpans(p);
  return removed;
}

/* ---------------- eraser tools ---------------- */
function startErase(e, p, x, y) {
  const m = state.eraserMode;
  if (m === 'smart') {
    const o = selObj();
    if (!o) { toast('Pehle text select karein (Select tool se), phir Smart Eraser par click karein', 'warn', 4200); return; }
    smartErase(p, o);
    return;
  }
  if (m === 'brush') {
    const pre = commit();
    const s = { kind: 'brush', pts: [{ x, y }], color: sampleBgColor(p, x, y), size: state.brushSize };
    p.fills.push(s);
    gesture.type = 'erase-brush'; gesture.page = p; gesture.pre = pre; gesture.stroke = s;
    gesture.sx = x; gesture.sy = y; gesture.moved = false;
    redrawFills(p);
    capture(e, p);
    return;
  }
  if (m === 'rect') {
    const pre = commit();
    const pv = el('<div class="erase-preview"></div>');
    p._el.sheet.appendChild(pv);
    gesture.type = 'erase-rect'; gesture.page = p; gesture.pre = pre;
    gesture.start = { x, y }; gesture.x = x; gesture.y = y; gesture.prev = pv;
    capture(e, p);
    return;
  }
  if (m === 'lasso') {
    if (!lassoPts) {
      lassoPts = [];
      lassoCv = el('<canvas class="lasso-preview"></canvas>');
      lassoCv.width = p.w; lassoCv.height = p.h;
      p._el.sheet.appendChild(lassoCv);
      toast('Click karke points banayein • Enter ya Double-click = finish • Esc = cancel', 'info', 3500);
    }
    lassoPts.push({ x, y });
    drawLassoPreview(p);
  }
}
function smartErase(p, o) {
  if (state.sel.type !== 'text') { toast('Smart Eraser ke liye pehle koi TEXT select karein', 'warn', 3000); return; }
  const pre = commit();
  const sw = o._w || o.w || 80, sh = o._h || o.fs * 1.4;
  const col = sampleBgColor(p, Math.max(0, o.x - 12), Math.max(0, o.y - 12));
  p.fills.push({ kind: 'rect', x: o.x - 5, y: o.y - 3, w: sw + 10, h: sh + 6, color: col });
  p.spans = p.spans.filter(s => s.id !== o.id);
  pushHistory(pre);
  select(null);
  rebuildSpans(p);
  redrawFills(p);
  toast('Text erase ho gaya (background auto-matched) — same jagah naya text add kar sakte hain', 'success', 3800);
}
function drawLassoPreview(p) {
  if (!lassoCv) return;
  const ctx = lassoCv.getContext('2d');
  ctx.clearRect(0, 0, p.w, p.h);
  if (!lassoPts || !lassoPts.length) return;
  ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  lassoPts.forEach((pt, i) => i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y));
  ctx.stroke();
  ctx.setLineDash([]);
  lassoPts.forEach(pt => { ctx.beginPath(); ctx.arc(pt.x, pt.y, 3.5, 0, 7); ctx.fillStyle = '#dc2626'; ctx.fill(); });
}
function lassoClear() {
  lassoPts = null;
  if (lassoCv) { lassoCv.remove(); lassoCv = null; }
}
function lassoFinish() {
  const p = curPage();
  if (!p || !lassoPts || lassoPts.length < 3) { lassoClear(); return; }
  const pre = commit();
  const cx = lassoPts.reduce((a, q) => a + q.x, 0) / lassoPts.length;
  const cy = lassoPts.reduce((a, q) => a + q.y, 0) / lassoPts.length;
  p.fills.push({ kind: 'poly', pts: lassoPts.slice(), color: sampleBgColor(p, cx, cy) });
  eraseCoveredSpans(p, { kind: 'poly', pts: lassoPts });
  lassoClear();
  pushHistory(pre);
  rebuildSpans(p);
  redrawFills(p);
  toast('Area erase ho gaya — Ctrl+Z se undo', 'success', 3000);
}

/* ---------------- ink / annotation ---------------- */
function startInk(e, p, x, y) {
  const pre = commit();
  const t = state.inkTool;
  const o = state.ink;
  const free = ['pen', 'marker', 'highlighter', 'signature'].includes(t);
  const s = free
    ? { type: t, pts: [{ x, y }], color: o.color, width: o.width, opacity: o.opacity }
    : { type: t, x1: x, y1: y, x2: x, y2: y, color: o.color, width: o.width, opacity: o.opacity };
  p.ink.push(s);
  gesture.type = 'ink'; gesture.page = p; gesture.pre = pre; gesture.stroke = s;
  gesture.moved = false;
  redrawInk(p);
  capture(e, p);
}
function clearInk() {
  const p = curPage();
  if (!p || !p.ink.length) return toast('Koi drawing nahi hai clear karne ke liye', 'info', 1800);
  const pre = commit();
  p.ink = [];
  pushHistory(pre);
  redrawInk(p);
  toast('Sab drawings clear ho gayin (Ctrl+Z se undo)', 'success', 2600);
}

/* ---------------- text editing ---------------- */
function startEdit(o, opts = {}) {
  if (!o || o._editing) return;
  const e = o._el;
  o._editing = true;
  e.contentEditable = 'true';
  e.classList.add('editing');
  o._preHtml = o.html;
  o._preSnap = snapshot();
  e.focus();
  if (opts.selectAll) {
    const r = document.createRange();
    r.selectNodeContents(e);
    const s = getSelection();
    s.removeAllRanges(); s.addRange(r);
  }
  renderProps();
  updateChrome();
}
function endEdit(o, silent = false) {
  if (!o || !o._editing) return;
  const p = curPage();
  const e = o._el;
  o._editing = false;
  e.contentEditable = 'false';
  e.classList.remove('editing');
  sanitizeEditable(e);
  o.html = e.innerHTML;
  o.plain = (e.innerText || '').replace(/\n+$/, '');
  if (!o.plain.trim()) {
    p.spans = p.spans.filter(s => s.id !== o.id);
    select(null);
  }
  updateMeasurements(p);
  if (o._preHtml !== o.html) pushHistory(o._preSnap);
  rebuildSpans(p);
  redrawFills(p);
  refreshSelectionUI(p);
  renderProps();
  updateChrome();
  if (!silent) syncFmtBar();
}
function endEditIfAny() {
  const p = curPage();
  if (!p) return;
  const o = p.spans.find(s => s._editing);
  if (o) endEdit(o, true);
}
function sanitizeEditable(root) {
  const bad = root.querySelectorAll('script,style,iframe,object,embed,form,a,link');
  bad.forEach(n => n.replaceWith(...n.childNodes));
  root.querySelectorAll('*').forEach(n => {
    [...n.attributes].forEach(at => {
      if (/^on/i.test(at.name) || at.name === 'href') n.removeAttribute(at.name);
    });
  });
}
function isEditingText() {
  const a = document.activeElement;
  return !!a && (a.isContentEditable || /^(input|select|textarea)$/i.test(a.tagName));
}

/* ---------------- formatting ---------------- */
function withCommitSet(o, fn) {
  if (!o || state.sel.type !== 'text') return;
  const pre = commit();
  fn();
  applySpanStyle(o);
  pushHistory(pre);
  updateMeasurements(curPage());
  redrawFills(curPage());
  refreshSelectionUI(curPage());
  renderProps();
  syncFmtBar();
}
function execFmt(cmd, val) {
  try { document.execCommand(cmd, false, val === undefined ? null : val); } catch (e) {}
  syncFmtBar();
}
function doFmt(fmt, srcEl) {
  const o = selObj();
  if (!o || state.sel.type !== 'text') return;
  const editing = o._editing;
  let val;
  if (srcEl) {
    if (srcEl.dataset && srcEl.dataset.val !== undefined) val = srcEl.dataset.val;
    else if (srcEl.type === 'checkbox') val = srcEl.checked;
    else val = srcEl.value;
  }
  switch (fmt) {
    case 'font': editing ? execFmt('fontName', val) : withCommitSet(o, () => { o.font = val; }); break;
    case 'fs': withCommitSet(o, () => { o.fs = clamp(parseFloat(val) || o.fs, 6, 300); }); break;
    case 'a+': case 'a-': {
      const d = fmt === 'a+' ? 2 : -2;
      withCommitSet(o, () => { o.fs = clamp(o.fs + d, 6, 300); });
      break;
    }
    case 'bold': editing ? execFmt('bold') : withCommitSet(o, () => { o.bold = !o.bold; }); break;
    case 'italic': editing ? execFmt('italic') : withCommitSet(o, () => { o.italic = !o.italic; }); break;
    case 'underline': editing ? execFmt('underline') : withCommitSet(o, () => { o.underline = !o.underline; }); break;
    case 'strike': editing ? execFmt('strikeThrough') : withCommitSet(o, () => { o.strike = !o.strike; }); break;
    case 'color': editing ? execFmt('foreColor', val) : withCommitSet(o, () => { o.color = val; }); break;
    case 'hl': editing ? (document.execCommand('hiliteColor', false, val) || document.execCommand('backColor', false, val)) : withCommitSet(o, () => { o.bg = val; }); break;
    case 'bg': withCommitSet(o, () => { o.bg = val || '#ffffff'; }); break;
    case 'align': withCommitSet(o, () => { o.align = val; }); break;
    case 'lh': withCommitSet(o, () => { o.lh = parseFloat(val) || 1.28; }); break;
    case 'ls': withCommitSet(o, () => { o.ls = parseFloat(val) || 0; }); break;
    case 'upper': case 'lower': transformCase(o, fmt); break;
    case 'sup': wrapWhole(o, 'sup'); break;
    case 'sub': wrapWhole(o, 'sub'); break;
    case 'ul': editing ? execFmt('insertUnorderedList') : toast('List apply karne ke liye text par double-click karke edit mode me aayein', 'info', 3200); break;
    case 'ol': editing ? execFmt('insertOrderedList') : toast('List apply karne ke liye text par double-click karke edit mode me aayein', 'info', 3200); break;
  }
}
function transformCase(o, mode) {
  const pre = commit();
  const walker = document.createTreeWalker(o._el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(n => { n.nodeValue = mode === 'upper' ? n.nodeValue.toUpperCase() : n.nodeValue.toLowerCase(); });
  o.html = o._el.innerHTML;
  o.plain = o._el.innerText;
  pushHistory(pre);
  renderProps();
}
function wrapWhole(o, tag) {
  const pre = commit();
  const open = `<${tag}>`, close = `</${tag}>`;
  if (o.html.startsWith(open)) o.html = o.html.slice(open.length, -close.length);
  else o.html = open + o.html + close;
  pushHistory(pre);
  const p = curPage();
  rebuildSpans(p);
  refreshSelectionUI(p);
  select('text', o.id);
}
function syncFmtBar() {
  const o = selObj();
  const bar = $('#formatBar');
  if (!o || state.sel.type !== 'text') return;
  const set = (sel, attr, v) => { const e2 = bar.querySelector(sel); if (e2) e2[attr] = v; };
  set('[data-fmt=font]', 'value', o.font || '');
  set('[data-fmt=fs]', 'value', o.fs);
  set('[data-fmt=color]', 'value', o.color || '#111827');
  set('[data-fmt=bg]', 'value', o.bg || '#ffffff');
  set('[data-fmt=lh]', 'value', String(o.lh || 1.28));
  set('[data-fmt=ls]', 'value', String(o.ls || 0));
  bar.querySelectorAll('[data-fmt=align]').forEach(b => b.classList.toggle('on', b.dataset.val === (o.align || 'left')));
  ['bold', 'italic', 'underline', 'strike'].forEach(f => {
    let on = o[f === 'strike' ? 'strike' : f];
    if (o._editing) { try { on = document.queryCommandState(f === 'strike' ? 'strikeThrough' : f); } catch (e) {} }
    const b = bar.querySelector(`[data-fmt=${f}]`);
    if (b) b.classList.toggle('on', !!on);
  });
}

/* ---------------- object ops ---------------- */
function createTextAt(x, y) {
  const p = curPage();
  const pre = commit();
  const o = {
    id: uid(), x: Math.max(0, x - 4), y: Math.max(0, y - 16),
    w: Math.min(430, Math.max(120, p.w - x - 10)),
    html: 'Naya text', plain: 'Naya text', fs: 18, font: null, color: '#111827',
    bold: false, italic: false, underline: false, strike: false,
    align: 'left', lh: 1.3, ls: 0, bg: '', border: null, shadow: 0, tshadow: 0, rot: 0, lowConf: false, z: 0,
  };
  p.spans.push(o);
  pushHistory(pre);
  rebuildSpans(p);
  setTool('select');
  select('text', o.id);
  startEdit(o, { selectAll: true });
}
function deleteSel() {
  const o = selObj();
  if (!o) return;
  endEditIfAny();
  const p = curPage();
  const pre = commit();
  if (state.sel.type === 'text') p.spans = p.spans.filter(s => s.id !== o.id);
  else p.images = p.images.filter(s => s.id !== o.id);
  pushHistory(pre);
  select(null);
  rebuildSpans(p); rebuildImages(p); redrawFills(p);
}
function cloneObj(o, dx, dy) {
  const c = JSON.parse(JSON.stringify(o));
  c.id = uid();
  c.x += dx; c.y += dy;
  delete c._el; delete c._w; delete c._h; delete c._editing; delete c._preHtml; delete c._preSnap;
  return c;
}
function dupeSel() {
  const o = selObj();
  if (!o) return;
  const p = curPage();
  const pre = commit();
  const c = cloneObj(o, 14, 14);
  (state.sel.type === 'text' ? p.spans : p.images).push(c);
  pushHistory(pre);
  rebuildSpans(p); rebuildImages(p);
  select(state.sel.type, c.id);
}
function copySel() {
  const o = selObj();
  if (!o) return;
  clip = { type: state.sel.type, data: JSON.stringify(o) };
  if (state.sel.type === 'text') { try { navigator.clipboard.writeText(o.plain || ''); } catch (e) {} }
  toast('Copy ho gaya — Ctrl+V se paste karein', 'info', 1800);
}
function cutSel() { copySel(); deleteSel(); }
function pasteClip() {
  if (!clip) return toast('Clipboard khaali hai', 'info', 1600);
  const p = curPage();
  const pre = commit();
  const o = JSON.parse(clip.data);
  o.id = uid();
  o.x += 14; o.y += 14;
  delete o._el;
  (clip.type === 'text' ? p.spans : p.images).push(o);
  pushHistory(pre);
  rebuildSpans(p); rebuildImages(p);
  select(clip.type, o.id);
}
function frontBack(front) {
  const o = selObj();
  if (!o) return;
  const p = curPage();
  const pre = commit();
  const arr = state.sel.type === 'text' ? p.spans : p.images;
  const i = arr.indexOf(o);
  if (i >= 0) { arr.splice(i, 1); front ? arr.push(o) : arr.unshift(o); }
  pushHistory(pre);
  rebuildSpans(p); rebuildImages(p);
}
function nudgeSel(dx, dy) {
  const o = selObj();
  if (!o) return;
  const pre = commit();
  o.x += dx; o.y += dy;
  applyPos(o);
  updateGizmo(o);
  pushHistory(pre);
  renderProps();
}

/* ---------------- image ops ---------------- */
async function readFileDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
let replaceTarget = null;
function pickImage() {
  if (!state.pages.length) return toast('Pehle document upload karein', 'warn', 2600);
  $('#imageInput').click();
}
async function handleInsertImage(file) {
  if (!file) return;
  const p = curPage();
  if (!p) return;
  if (file.size > MAX_IMG_INSERT) return toast('File bahut large hai (max 20MB)', 'error', 4000);
  try {
    const url = await readFileDataUrl(file);
    const img = await dataUrlToImage(url);
    let src = url;
    let iw = img.width, ih = img.height;
    if (Math.max(iw, ih) > 1600) {
      const sc = 1600 / Math.max(iw, ih);
      iw = Math.round(iw * sc); ih = Math.round(ih * sc);
      const c = document.createElement('canvas');
      c.width = iw; c.height = ih;
      c.getContext('2d').drawImage(img, 0, 0, iw, ih);
      src = /png|webp|svg/.test(file.type) ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92);
    }
    if (replaceTarget) {
      const o = replaceTarget;
      const pre = commit();
      o.src = src;
      pushHistory(pre);
      rebuildImages(p);
      select('image', o.id);
      toast('Image replace ho gayi', 'success', 2600);
      replaceTarget = null;
      return;
    }
    const scale = clamp(Math.min((p.w * 0.62) / iw, (p.h * 0.62) / ih, 1.4), 0.05, 1.4);
    const w = Math.round(iw * scale), h = Math.round(ih * scale);
    const o = {
      id: uid(), src,
      x: Math.round((p.w - w) / 2), y: Math.round((p.h - h) / 2),
      w, h, rot: 0, opacity: 1, border: null, shadow: false,
      shape: 'rect', flipH: false, flipV: false, lockAspect: true,
      name: file.name, z: 0,
    };
    const pre = commit();
    p.images.push(o);
    pushHistory(pre);
    rebuildImages(p);
    select('image', o.id);
    toast('Image/logo add ho gayi — resize, rotate, crop, opacity, flip change karein', 'success', 4000);
  } catch (e) {
    toast('Image load nahi ho saki — dobara try karein', 'error');
  }
}

/* ---------------- crop modal ---------------- */
const crop = { o: null, img: null, ds: 1, ox: 0, oy: 0, sx: 0, sy: 0, sw: 0, sh: 0, preset: 'free' };
function openCrop(o) {
  crop.o = o; crop.preset = 'free';
  const stage = $('#cropStage');
  stage.innerHTML = '';
  const img = new Image();
  stage.appendChild(el(`<div class="crop-box" id="cropBox"><div class="cz nw" data-c="nw"></div><div class="cz ne" data-c="ne"></div><div class="cz sw" data-c="sw"></div><div class="cz se" data-c="se"></div></div>`));
  img.onload = () => {
    const maxW = stage.clientWidth - 8, maxH = Math.min(480, innerHeight * 0.52);
    crop.ds = Math.min(maxW / img.width, maxH / img.height, 1);
    crop.ox = (stage.clientWidth - img.width * crop.ds) / 2;
    crop.oy = (stage.clientHeight - img.height * crop.ds) / 2;
    crop.sx = 0; crop.sy = 0; crop.sw = img.width; crop.sh = img.height;
    const im = el(`<img src="${o.src}" alt="crop image" draggable="false">`);
    im.style.width = img.width * crop.ds + 'px';
    im.style.height = img.height * crop.ds + 'px';
    stage.insertBefore(im, stage.firstChild);
    crop.img = img;
    positionCropBox();
  };
  img.src = o.src;
  openModal('cropModal');
}
function positionCropBox() {
  const box = $('#cropBox');
  if (!box) return;
  box.style.left = (crop.ox + crop.sx * crop.ds) + 'px';
  box.style.top = (crop.oy + crop.sy * crop.ds) + 'px';
  box.style.width = (crop.sw * crop.ds) + 'px';
  box.style.height = (crop.sh * crop.ds) + 'px';
}
function cropPreset(val) {
  crop.preset = val;
  const img = crop.img;
  if (!img) return;
  const cx = crop.sx + crop.sw / 2, cy = crop.sy + crop.sh / 2;
  let ratio = null, circ = false;
  if (val === 'square') ratio = 1;
  if (val === '16:9') ratio = 16 / 9;
  if (val === '4:3') ratio = 4 / 3;
  if (val === 'circle') { ratio = 1; circ = true; }
  if (circ) { const s = Math.min(crop.sw, crop.sh); crop.sx = cx - s / 2; crop.sy = cy - s / 2; crop.sw = s; crop.sh = s; }
  else if (ratio) {
    let w = crop.sw, h = w / ratio;
    if (h > img.height * 0.98) { h = img.height * 0.98; w = h * ratio; }
    crop.sw = w; crop.sh = h; crop.sx = cx - w / 2; crop.sy = cy - h / 2;
  }
  clampCrop();
  positionCropBox();
}
function clampCrop() {
  const img = crop.img;
  crop.sw = clamp(crop.sw, 8, img.width);
  crop.sh = clamp(crop.sh, 8, img.height);
  crop.sx = clamp(crop.sx, 0, img.width - crop.sw);
  crop.sy = clamp(crop.sy, 0, img.height - crop.sh);
}
async function applyCrop() {
  const o = crop.o;
  if (!crop.img) return;
  clampCrop();
  const c = document.createElement('canvas');
  c.width = Math.round(crop.sw); c.height = Math.round(crop.sh);
  c.getContext('2d').drawImage(crop.img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, c.width, c.height);
  const keepPng = /png|webp/.test(o.name || '') || /image\/png/.test(o.src);
  const src = keepPng ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92);
  const p = curPage();
  const pre = commit();
  o.src = src;
  o.shape = crop.preset === 'circle' ? 'circle' : 'rect';
  o.h = Math.round(o.w * (c.height / c.width));
  o.lockAspect = true;
  pushHistory(pre);
  rebuildImages(p);
  refreshSelectionUI(p);
  select('image', o.id);
  renderProps();
  closeModal('cropModal');
  toast('Crop apply ho gaya', 'success', 2400);
}
function wireCrop() {
  const stage = () => $('#cropStage');
  let g = null;
  stage().addEventListener('pointerdown', (e) => {
    if (!crop.img) return;
    e.preventDefault();
    const r = stage().getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const h = e.target.closest('.cz');
    g = {
      mode: h ? 'resize' : (e.target.closest('.crop-box') ? 'move' : null),
      handle: h ? h.dataset.c : null,
      sx: x, sy: y,
      start: { sx: crop.sx, sy: crop.sy, sw: crop.sw, sh: crop.sh },
      ratio: crop.preset === 'square' || crop.preset === 'circle' ? 1 : (crop.preset === '16:9' ? 16 / 9 : (crop.preset === '4:3' ? 4 / 3 : 0)),
    };
    stage().setPointerCapture(e.pointerId);
  });
  stage().addEventListener('pointermove', (e) => {
    if (!g || !crop.img) return;
    const r = stage().getBoundingClientRect();
    const dx = (e.clientX - r.left - g.sx) / crop.ds;
    const dy = (e.clientY - r.top - g.sy) / crop.ds;
    const s = g.start;
    if (g.mode === 'move') {
      crop.sx = s.sx + dx; crop.sy = s.sy + dy;
      clampCrop();
    } else if (g.mode === 'resize') {
      if (g.handle.includes('e')) crop.sw = s.sw + dx;
      if (g.handle.includes('w')) { crop.sw = s.sw - dx; crop.sx = s.sx + (s.sw - crop.sw); }
      if (g.handle.includes('s')) crop.sh = s.sh + dy;
      if (g.handle.includes('n')) { crop.sh = s.sh - dy; crop.sy = s.sy + (s.sh - crop.sh); }
      if (g.ratio) {
        if (g.handle === 'n' || g.handle === 's') crop.sw = crop.sh * g.ratio;
        else crop.sh = crop.sw / g.ratio;
        if (g.handle.includes('n')) crop.sy = s.sy + (s.sh - crop.sh);
        if (g.handle.includes('w')) crop.sx = s.sx + (s.sw - crop.sw);
      }
      if (crop.sw < 8) { crop.sw = 8; }
      if (crop.sh < 8) { crop.sh = 8; }
      clampCrop();
    }
    positionCropBox();
  });
  ['pointerup', 'pointercancel'].forEach(ev => stage().addEventListener(ev, () => { g = null; }));
}

/* ---------------- page ops ---------------- */
const SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008] };
function sizeLabel(p) {
  for (const [k, [w, h]] of Object.entries(SIZES)) {
    if (Math.abs(p.ptW - w) < 3 && Math.abs(p.ptH - h) < 3) return k.toUpperCase();
  }
  return Math.round(p.ptW / 2.8346) + ' × ' + Math.round(p.ptH / 2.8346) + ' mm (custom)';
}
function openAddPage() { openModal('addPageModal'); }
function confirmAddPage() {
  let ptW, ptH;
  const v = document.querySelector('input[name=pagesize]:checked').value;
  if (v === 'custom') {
    const w = parseFloat($('#customW').value) || 210;
    const h = parseFloat($('#customH').value) || 297;
    ptW = clamp(w, 50, 1000) * 2.8346; ptH = clamp(h, 50, 1000) * 2.8346;
  } else { [ptW, ptH] = SIZES[v]; }
  closeModal('addPageModal');
  addBlankPage(ptW, ptH);
}
function addBlankPage(ptW, ptH, afterIdx) {
  const w = 1000, h = Math.round(1000 * ptH / ptW);
  const id = uid();
  const p = makePage(id, 'blank', { w, h, ptW, ptH, bg: blankPageDataUrl(w, h) });
  const pre = commit();
  const idx = afterIdx === undefined ? state.cur + 1 : afterIdx;
  state.pages.splice(idx, 0, p);
  pushHistory(pre);
  state.cur = idx;
  renderAll();
  toast('Naya blank page add ho gaya (' + sizeLabel(p) + ') — text, image ya drawing add karein', 'success', 3500);
}
function duplicatePage() {
  const p = curPage();
  if (!p) return;
  const pre = commit();
  const c = JSON.parse(JSON.stringify(p));
  c.id = uid();
  c.spans.forEach(s => { s.id = uid(); delete s._el; delete s._w; delete s._h; });
  c.images.forEach(s => { s.id = uid(); delete s._el; });
  bgStore.set(c.id, bgStore.get(p.id));
  state.pages.splice(state.cur + 1, 0, c);
  pushHistory(pre);
  state.cur++;
  renderAll();
  toast('Page duplicate ho gaya', 'success', 2400);
}
function deletePage() {
  if (state.pages.length <= 1) return toast('Kam se kam 1 page chahiye — blank page delete karne ke bajaye naya add karein', 'warn', 3500);
  const p = curPage();
  const pre = commit();
  state.pages.splice(state.cur, 1);
  state.cur = clamp(state.cur - 1, 0, state.pages.length - 1);
  pushHistory(pre);
  renderAll();
  toast('Page delete ho gaya (Ctrl+Z se undo)', 'success', 2600);
}
function reorderPages(from, to) {
  if (from === to || from < 0 || to < 0 || from >= state.pages.length || to >= state.pages.length) return;
  const pre = commit();
  const [pg] = state.pages.splice(from, 1);
  state.pages.splice(to, 0, pg);
  if (state.cur === from) state.cur = to;
  else if (from < state.cur && to >= state.cur) state.cur--;
  else if (from > state.cur && to <= state.cur) state.cur++;
  pushHistory(pre);
  renderAll();
}
function movePage(dir) { reorderPages(state.cur, state.cur + dir); }
async function rotatePage90() {
  const p = curPage();
  if (!p) return;
  const pre = commit();
  try {
    const img = await getBgImg(p);
    const W = p.w, H = p.h;
    const c = document.createElement('canvas');
    c.width = H; c.height = W;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.translate(H, 0); ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, 0, 0);
    bgStore.set(p.id, c.toDataURL('image/jpeg', 0.92));
    const ni = new Image();
    ni.src = bgStore.get(p.id);
    bgImgs.set(p.id, Promise.resolve(ni));
    try { await ni.decode(); } catch (err) {}
    p._bgImg = ni;
    bgCvs.delete(p.id);
    remapPage(p, W, H);
    p.rot90 = (p.rot90 + 1) % 4;
    pushHistory(pre);
    renderAll();
    fitZoom();
    toast('Page 90° rotate ho gaya', 'success', 2400);
  } catch (e) {
    toast('Rotate failed — dobara try karein', 'error');
  }
}
function remapPage(p, W, H) {
  const T = (x, y) => [H - y, x]; // 90° CW
  const remapBox = (o, w, h) => {
    const [ax, ay] = T(o.x, o.y);
    const [bx, by] = T(o.x + w, o.y + h);
    o.x = Math.min(ax, bx); o.y = Math.min(ay, by);
    o.w = Math.abs(bx - ax);
    return Math.abs(by - ay);
  };
  for (const o of p.spans) {
    const w = o._w || o.w || 80, h = o._h || o.fs * 1.4;
    const nh = remapBox(o, w, h);
    o.h = undefined;
    o.rot = (o.rot + 90) % 360;
  }
  for (const o of p.images) {
    const nh = remapBox(o, o.w, o.h);
    o.h = nh;
    o.rot = (o.rot + 90) % 360;
  }
  for (const f of p.fills) {
    if (f.kind === 'brush' || f.kind === 'poly') f.pts = f.pts.map(pt => { const [x, y] = T(pt.x, pt.y); return { x, y }; });
    else if (f.kind === 'rect') { const nh = remapBox(f, f.w, f.h); f.h = nh; }
  }
  for (const k of p.ink) {
    if (k.pts) k.pts = k.pts.map(pt => { const [x, y] = T(pt.x, pt.y); return { x, y }; });
    else { const [x1, y1] = T(k.x1, k.y1); const [x2, y2] = T(k.x2, k.y2); k.x1 = x1; k.y1 = y1; k.x2 = x2; k.y2 = y2; }
  }
  p.w = H; p.h = W;
  const tw = p.ptW; p.ptW = p.ptH; p.ptH = tw;
  delete p._bgColor;
  delete p._w; delete p._h;
}
async function reOcrPage(p) {
  showOcr('Re-OCR…', 0, 'OCR run ho raha hai…');
  p._bgUrl = bgStore.get(p.id);
  const pre = commit();
  try {
    const oldSpans = p.spans;
    p.spans = [];
    await ocrPages([p], state.ocrLang, (f, msg) => setOcr(0.05 + f * 0.9, msg));
    pushHistory(pre);
    toast(`Re-OCR complete — ${p.spans.length} text blocks mil gaye`, 'success', 3200);
  } catch (e) {
    p.spans = oldSpans;
    toast('OCR processing failed — Internet connection check karein', 'error', 5000);
  } finally {
    hideOcr();
    renderAll();
  }
}

/* ---------------- tool switching & chrome ---------------- */
function setTool(t) {
  state.tool = t;
  const p = curPage();
  if (p && p._el) p._el.sheet.className = 'sheet tool-' + t;
  select(null);
  lassoClear();
  updateChrome();
  renderProps();
}
function toggleRef() {
  state.showRef = !state.showRef;
  const p = curPage();
  if (p) redrawFills(p);
  renderProps();
  updateChrome();
  toast(state.showRef ? 'Original background ON — OCR text reference ke saath' : 'Original background OFF — original text hidden (clean view)', 'info', 2600);
}
function updateChrome() {
  const badge = $('#docBadge');
  if (state.pages.length) {
    badge.classList.remove('hidden');
    badge.textContent = `${state.baseName} • ${state.pages.length} page${state.pages.length > 1 ? 's' : ''} • ${(state.sourceType || '').toUpperCase()}`;
    document.title = `SmartDoc Editor — ${state.baseName}`;
  } else {
    badge.classList.add('hidden');
    document.title = 'SmartDoc Editor — PDF & Document Text Editor with OCR';
  }
  document.querySelectorAll('[data-act^="tool:"]').forEach(b => {
    b.classList.toggle('active', state.tool === b.dataset.act.slice(5));
  });
  const eb = document.querySelector('[data-act="menu:erase"]');
  if (eb) eb.classList.toggle('active', state.tool === 'erase');
  const db = document.querySelector('[data-act="menu:draw"]');
  if (db) db.classList.toggle('active', state.tool === 'ink');
  const ub = document.querySelector('[data-act="undo"]');
  const rb = document.querySelector('[data-act="redo"]');
  if (ub) ub.disabled = !history.undo.length;
  if (rb) rb.disabled = !history.redo.length;
  const mob = document.querySelectorAll('.mtool');
  mob.forEach(b => {
    const a = b.dataset.act || '';
    b.classList.toggle('active', a === 'tool:select' ? state.tool === 'select' : a === 'tool:text' ? state.tool === 'text' : false);
  });
  const refB = document.querySelector('[data-act="toggleRef"]');
  if (refB) {
    refB.innerHTML = icon(state.showRef ? 'eyeOff' : 'eye');
    refB.title = state.showRef ? 'Original text hide karein (clean view)' : 'Original text dikhayein (reference)';
    refB.classList.toggle('active', !state.showRef);
  }
  const fb = $('#formatBar');
  if (fb) fb.classList.toggle('hidden', !state.pages.length || !state.sel || state.sel.type !== 'text' || state.preview);
  const pb = $('#previewBtn');
  if (pb) pb.classList.toggle('active', state.preview);
}
let _prevShowRef = null;
function togglePreview() {
  if (!state.pages.length) return;
  state.preview = !state.preview;
  $('#app').classList.toggle('previewing', state.preview);
  $('#previewBanner').classList.toggle('hidden', !state.preview);
  $('#previewBtn').classList.toggle('active', state.preview);
  if (state.preview) {
    // preview shows the CLEAN export view (original text replaced by editable layers)
    _prevShowRef = state.showRef;
    state.showRef = false;
    const p = curPage();
    if (p) redrawFills(p);
    select(null);
    lassoClear();
    fitZoom();
    toast('Preview mode — yahi final document export hoga (clean view)', 'info', 3000);
  } else {
    if (_prevShowRef !== null && _prevShowRef !== undefined) {
      state.showRef = _prevShowRef;
      const p = curPage();
      if (p) redrawFills(p);
    }
  }
  updateChrome();
  renderProps();
}

/* ---------------- property panel ---------------- */
function renderProps() {
  const box = $('#propsContent');
  if (!box) return;
  const o = selObj();
  let h = '';
  if (o && state.sel.type === 'text') h += textPropsHtml(o);
  else if (o && state.sel.type === 'image') h += imagePropsHtml(o);
  h += pagePropsHtml();
  h += toolPropsHtml();
  h += docPropsHtml();
  box.innerHTML = h;
}
const FOND = ['Arial, Helvetica, sans-serif', 'Times New Roman, Times, serif', 'Courier New, Courier, monospace', 'Verdana, Geneva, sans-serif', 'Georgia, serif', 'Trebuchet MS, sans-serif', 'Tahoma, sans-serif', 'Garamond, serif', 'Noto Sans, sans-serif', 'Impact, fantasy'];
function fontOpts(sel) {
  return FOND.map(f => `<option value="${esc(f)}" ${f === sel ? 'selected' : ''}>${f.split(',')[0]}</option>`).join('');
}
function textPropsHtml(o) {
  const p = curPage();
  return `<div class="p-sec">
  <div class="p-title">${icon('text')} Text ${o._editing ? '· editing' : ''} ${o.lowConf ? '<span class="p-badge warn" style="margin-left:auto">low confidence</span>' : ''}</div>
  <div class="p-row"><label>Font</label><select data-act="sp.font">${fontOpts(o.font || p.font)}</select></div>
  <div class="p-row"><label>Size</label><input type="number" data-act="sp.fs" value="${Math.round(o.fs)}" min="6" max="300"><button class="p-ico" data-act="sp.a-" title="A- chhota">A−</button><button class="p-ico" data-act="sp.a+" title="A+ bada">A+</button></div>
  <div class="p-ico-row">
    <button class="p-ico ${o.bold ? 'on' : ''}" data-act="sp.bold" title="Bold (Ctrl+B)">B</button>
    <button class="p-ico i ${o.italic ? 'on' : ''}" data-act="sp.italic" title="Italic (Ctrl+I)">I</button>
    <button class="p-ico u ${o.underline ? 'on' : ''}" data-act="sp.underline" title="Underline (Ctrl+U)">U</button>
    <button class="p-ico s ${o.strike ? 'on' : ''}" data-act="sp.strike" title="Strikethrough">S</button>
    <button class="p-ico" data-act="sp.upper" title="UPPERCASE">AA</button>
    <button class="p-ico" data-act="sp.lower" title="lowercase">aa</button>
    <button class="p-ico" data-act="sp.sup" title="Superscript">x²</button>
    <button class="p-ico" data-act="sp.sub" title="Subscript">x₂</button>
  </div>
  <div class="p-row"><label>Color</label><input type="color" data-act="sp.color" value="${o.color || '#111827'}"><label style="width:auto">Highlight</label><input type="color" data-act="sp.hl" value="${o.bg || '#fef08a'}"></div>
  <div class="p-row"><label>Box background</label><input type="color" data-act="sp.bg" value="${o.bg || '#ffffff'}"><button class="p-ico" data-act="sp.bg-none" title="Background hataayein">✕</button></div>
  <div class="p-ico-row" style="margin-bottom:8px">
    <button class="p-ico ${o.align === 'left' ? 'on' : ''}" data-act="sp.align" data-val="left" title="Align left">${icon('alignL')}</button>
    <button class="p-ico ${o.align === 'center' ? 'on' : ''}" data-act="sp.align" data-val="center" title="Center">${icon('alignC')}</button>
    <button class="p-ico ${o.align === 'right' ? 'on' : ''}" data-act="sp.align" data-val="right" title="Right">${icon('alignR')}</button>
    <button class="p-ico ${o.align === 'justify' ? 'on' : ''}" data-act="sp.align" data-val="justify" title="Justify">${icon('alignJ')}</button>
    <button class="p-ico" data-act="sp.ul" title="Bulleted list (edit mode me)">${icon('ul')}</button>
    <button class="p-ico" data-act="sp.ol" title="Numbered list (edit mode me)">${icon('ol')}</button>
  </div>
  <div class="p-row"><label>Line spacing</label><select data-act="sp.lh">${[0.9, 1, 1.15, 1.28, 1.5, 2].map(v => `<option value="${v}" ${(o.lh || 1.28) === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
  <label style="width:auto">Letter</label><select data-act="sp.ls">${[-1, 0, 0.5, 1, 2].map(v => `<option value="${v}" ${(o.ls || 0) === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
  <div class="p-row"><label>Box border</label><input type="checkbox" data-act="sp.border" ${o.border ? 'checked' : ''}><input type="color" data-act="sp.borderc" value="${(o.border && o.border.c) || '#2563eb'}"></div>
  <div class="p-row"><label>Box shadow</label><input type="checkbox" data-act="sp.shadow" ${o.shadow ? 'checked' : ''}><input type="range" data-act="sp.shadoww" min="2" max="24" value="${o.shadow || 8}"></div>
  <div class="p-row"><label>Text shadow</label><input type="checkbox" data-act="sp.tshadow" ${o.tshadow ? 'checked' : ''}><input type="range" data-act="sp.tshadoww" min="1" max="8" value="${o.tshadow || 2}"></div>
  <div class="p-row"><label>Rotate (°)</label><input type="number" data-act="sp.rot" value="${Math.round(o.rot || 0)}" min="-360" max="360"><button class="p-ico" data-act="sp.rot-reset" title="Rotation reset">⟲</button></div>
  <div class="p-row"><label>Position X/Y</label><input type="number" data-act="sp.x" value="${Math.round(o.x)}"><input type="number" data-act="sp.y" value="${Math.round(o.y)}"></div>
  <button class="p-btn" data-act="sp.match" style="width:100%;margin-bottom:6px">${icon('target')} Match original document font</button>
  <div class="p-btns">
    <button class="p-btn" data-act="sp.dupe">${icon('copy')} Duplicate</button>
    <button class="p-btn danger" data-act="sp.del">${icon('trash')} Delete</button>
    <button class="p-btn" data-act="sp.front">${icon('front')} Front</button>
    <button class="p-btn" data-act="sp.back">${icon('back')} Back</button>
  </div>
  <p class="p-hint" style="margin-top:8px">Double-click karke text edit karein • Ctrl+C/V copy-paste • Ctrl+D duplicate • Delete se remove • Arrow keys se move</p>
</div>`;
}
function imagePropsHtml(o) {
  return `<div class="p-sec">
  <div class="p-title">${icon('image')} Image / Logo</div>
  <p class="p-hint" style="margin-bottom:8px;word-break:break-all">${esc(o.name || '')}</p>
  <div class="p-row"><label>Opacity</label><input type="range" data-act="im.opacity" min="5" max="100" value="${Math.round((o.opacity ?? 1) * 100)}"><span style="font-size:11px;width:34px;text-align:right">${Math.round((o.opacity ?? 1) * 100)}%</span></div>
  <div class="p-row"><label>Shape</label><button class="p-btn ${o.shape === 'rect' ? 'on' : ''}" data-act="im.shape" data-val="rect" style="flex:1">▭ Square</button><button class="p-btn ${o.shape === 'circle' ? 'on' : ''}" data-act="im.shape" data-val="circle" style="flex:1">● Circle</button></div>
  <div class="p-row"><label>Rotate (°)</label><input type="number" data-act="im.rot" value="${Math.round(o.rot || 0)}" min="-360" max="360"><button class="p-ico" data-act="im.rot-reset">⟲</button></div>
  <div class="p-row"><label>Width / Height</label><input type="number" data-act="im.w" value="${Math.round(o.w)}" min="8"><input type="number" data-act="im.h" value="${Math.round(o.h)}" min="8"></div>
  <div class="p-row"><label>Border</label><input type="checkbox" data-act="im.border" ${o.border ? 'checked' : ''}><input type="color" data-act="im.borderc" value="${(o.border && o.border.c) || '#2563eb'}"></div>
  <div class="p-row"><label>Shadow</label><input type="checkbox" data-act="im.shadow" ${o.shadow ? 'checked' : ''}</div>
  <div class="p-row"><label>Aspect lock</label><input type="checkbox" data-act="im.lock" ${o.lockAspect !== false ? 'checked' : ''}></div>
  <div class="p-ico-row">
    <button class="p-ico" data-act="im.flipH" title="Flip horizontal">${icon('flipH')}</button>
    <button class="p-ico" data-act="im.flipV" title="Flip vertical">${icon('flipV')}</button>
    <button class="p-ico" data-act="im.crop" title="Crop">${icon('crop')}</button>
    <button class="p-ico" data-act="im.replace" title="Replace image">${icon('refresh')}</button>
  </div>
  <div class="p-btns" style="margin-top:8px">
    <button class="p-btn" data-act="im.dupe">${icon('copy')} Duplicate</button>
    <button class="p-btn danger" data-act="im.del">${icon('trash')} Delete</button>
    <button class="p-btn" data-act="im.front">${icon('front')} Front</button>
    <button class="p-btn" data-act="im.back">${icon('back')} Back</button>
  </div>
  <p class="p-hint" style="margin-top:8px">Transparent PNG ka transparency preserve hota hai • Crop: free / 1:1 / 16:9 / 4:3 / circle</p>
</div>`;
}
function pagePropsHtml() {
  const p = curPage();
  if (!p) return '';
  const ocrBtn = (p.kind === 'image' || p.scanned) ? `<button class="p-btn" data-act="pg.ocr" style="width:100%;margin-bottom:6px">${icon('refresh')} Re-run OCR is page par</button>` : '';
  return `<div class="p-sec">
  <div class="p-title">${icon('page')} Page ${state.cur + 1} / ${state.pages.length}</div>
  <div class="p-row" style="flex-wrap:wrap">
    <span class="p-badge">${sizeLabel(p)}</span>
    <span class="p-badge">${p.ptW > p.ptH ? 'Landscape' : 'Portrait'}</span>
    <span class="p-badge ${p.kind === 'pdf' ? (p.scanned ? 'warn' : 'ok') : 'ok'}">${p.kind === 'pdf' ? (p.scanned ? 'Scanned PDF' : 'Searchable PDF') : p.kind === 'blank' ? 'Blank page' : 'Image / Screenshot'}</span>
  </div>
  ${ocrBtn}
  <div class="p-btns">
    <button class="p-btn" data-act="pg.rot">${icon('rotateCw')} Rotate 90°</button>
    <button class="p-btn" data-act="pg.dupe">${icon('copy')} Duplicate</button>
    <button class="p-btn" data-act="pg.up">↑ Move up</button>
    <button class="p-btn" data-act="pg.down">↓ Move down</button>
    <button class="p-btn danger" data-act="pg.del" style="grid-column:1/-1">${icon('trash')} Delete page</button>
  </div>
  <p class="p-hint" style="margin-top:8px">Reorder ke liye left sidebar me thumbnails drag karein</p>
</div>`;
}
function toolPropsHtml() {
  const t = state.tool;
  if (t === 'erase') {
    const modes = [
      ['smart', 'target', 'Smart eraser'],
      ['brush', 'eraser', 'Brush (bg match)'],
      ['rect', 'square', 'Rectangle'],
      ['lasso', 'circle', 'Lasso'],
    ];
    return `<div class="p-sec">
    <div class="p-title">${icon('eraser')} Eraser tool</div>
    <div class="p-btns">
      ${modes.map(([m, ic, lb]) => `<button class="p-btn ${state.eraserMode === m ? 'on' : ''}" data-act="in.mode" data-val="${m}">${icon(ic)} ${lb}</button>`).join('')}
    </div>
    <div class="p-row" style="margin-top:8px"><label>Brush size</label><input type="range" data-act="in.brush" min="6" max="90" value="${state.brushSize}"><span style="font-size:11px;width:30px;text-align:right">${state.brushSize}</span></div>
    <label class="f-check" style="font-size:12px"><span class="p-badge ok">●</span> Background color auto-detect hota hai (white/cream/grey/colored match)</label>
    <p class="p-hint">Smart: text select karke click → text + background erase. Brush/Rect/Lasso: paint karo → us area ka text bhi remove + background fill. Ctrl+Z se undo.</p>
  </div>`;
  }
  if (t === 'ink') {
    return `<div class="p-sec">
    <div class="p-title">${icon('pen')} Draw / Annotate</div>
    <div class="p-row"><label>Color</label><input type="color" data-act="in.color" value="${state.ink.color}">
    <label style="width:auto">Width</label><input type="range" data-act="in.width" min="1" max="24" value="${state.ink.width}"></div>
    <div class="p-row"><label>Opacity</label><input type="range" data-act="in.opacity" min="10" max="100" value="${Math.round(state.ink.opacity * 100)}"><span style="font-size:11px;width:34px;text-align:right">${Math.round(state.ink.opacity * 100)}%</span></div>
    <div class="p-hint" style="margin-bottom:8px">Pen / Marker / Highlighter / Line / Arrow / Rectangle / Circle / Signature — top ya bottom toolbar ke Draw menu se select karein.</div>
    <button class="p-btn danger" data-act="in.clear" style="width:100%">${icon('trash')} Clear all drawings (is page)</button>
  </div>`;
  }
  if (t === 'text') {
    return `<div class="p-sec">
    <div class="p-title">${icon('text')} Add Text</div>
    <p class="p-hint">Canvas par kisi bhi jagah <b>click karein</b> → text box ban jayega aur edit mode me aa jayega. Font, size, color, alignment, shadow, border — right panel me change karein.</p>
  </div>`;
  }
  return `<div class="p-sec">
    <div class="p-title">${icon('cursor')} Select / Move</div>
    <p class="p-hint">Text ya image par <b>click</b> → select • drag → move • handles → resize/rotate • <b>double-click</b> → edit text. Empty area par click → deselect.</p>
  </div>`;
}
function docPropsHtml() {
  return `<div class="p-sec">
  <div class="p-title">${icon('save')} Document</div>
  <div class="p-row"><label>OCR language</label><select data-act="doc.lang">
    <option value="hin+eng" ${state.ocrLang === 'hin+eng' ? 'selected' : ''}>Hindi + English</option>
    <option value="eng" ${state.ocrLang === 'eng' ? 'selected' : ''}>English only</option>
    <option value="hin" ${state.ocrLang === 'hin' ? 'selected' : ''}>Hindi only</option>
  </select></div>
  <label class="f-check" style="font-size:12.5px"><input type="checkbox" data-act="doc.ref" ${state.showRef ? 'checked' : ''}> Original text dikhayein (reference mode)</label>
  <button class="p-btn" data-act="doc.saveproj" style="width:100%;margin-bottom:6px">${icon('save')} Save project file (JSON)</button>
  <button class="p-btn" data-act="doc.openproj" style="width:100%">${icon('open')} Open project file</button>
  <p class="p-hint" style="margin-top:8px">🔒 Files sirf aapke browser me process hoti hain — kahin upload nahi hoti. Draft har 2-3 sec auto-save hota hai. Ctrl+S se project save.</p>
</div>`;
}
function onPropsClick(b) {
  const act = b.dataset.act;
  const val = b.dataset.val;
  const o = selObj();
  if (act.startsWith('sp.')) {
    if (!o) return;
    switch (act) {
      case 'sp.bold': withCommitSet(o, () => { o.bold = !o.bold; }); break;
      case 'sp.italic': withCommitSet(o, () => { o.italic = !o.italic; }); break;
      case 'sp.underline': withCommitSet(o, () => { o.underline = !o.underline; }); break;
      case 'sp.strike': withCommitSet(o, () => { o.strike = !o.strike; }); break;
      case 'sp.a-': doFmt('a-'); break;
      case 'sp.a+': doFmt('a+'); break;
      case 'sp.align': withCommitSet(o, () => { o.align = val; }); break;
      case 'sp.upper': transformCase(o, 'upper'); break;
      case 'sp.lower': transformCase(o, 'lower'); break;
      case 'sp.sup': wrapWhole(o, 'sup'); break;
      case 'sp.sub': wrapWhole(o, 'sub'); break;
      case 'sp.ul': doFmt('ul'); break;
      case 'sp.ol': doFmt('ol'); break;
      case 'sp.bg-none': withCommitSet(o, () => { o.bg = ''; }); break;
      case 'sp.rot-reset': withCommitSet(o, () => { o.rot = 0; }); break;
      case 'sp.match': {
        const p = curPage();
        withCommitSet(o, () => { o.font = p.font || 'Arial, Helvetica, sans-serif'; });
        toast('Document ka default font apply ho gaya', 'success', 2400);
        break;
      }
      case 'sp.dupe': dupeSel(); break;
      case 'sp.del': deleteSel(); break;
      case 'sp.front': frontBack(true); break;
      case 'sp.back': frontBack(false); break;
    }
  } else if (act.startsWith('im.')) {
    if (!o) return;
    const pre = commit();
    switch (act) {
      case 'im.shape': o.shape = val; break;
      case 'im.shadow': o.shadow = !o.shadow; break;
      case 'im.flipH': o.flipH = !o.flipH; break;
      case 'im.flipV': o.flipV = !o.flipV; break;
      case 'im.rot-reset': o.rot = 0; break;
      case 'im.crop': openCrop(o); return;
      case 'im.replace': replaceTarget = o; $('#replaceInput').click(); return;
      case 'im.dupe': dupeSel(); return;
      case 'im.del': deleteSel(); return;
      case 'im.front': frontBack(true); return;
      case 'im.back': frontBack(false); return;
    }
    pushHistory(pre);
    applyImgStyle(o);
    refreshSelectionUI(curPage());
    renderProps();
  } else if (act.startsWith('pg.')) {
    switch (act) {
      case 'pg.rot': rotatePage90(); break;
      case 'pg.dupe': duplicatePage(); break;
      case 'pg.del': deletePage(); break;
      case 'pg.up': movePage(-1); break;
      case 'pg.down': movePage(1); break;
      case 'pg.ocr': { const p = curPage(); if (p) reOcrPage(p); break; }
    }
  } else if (act.startsWith('in.')) {
    switch (act) {
      case 'in.mode': state.eraserMode = val; renderProps(); toast('Eraser mode: ' + val, 'info', 1500); break;
      case 'in.brush': state.brushSize = parseInt(b.value, 10); renderPropsLive(b); break;
      case 'in.width': state.ink.width = parseInt(b.value, 10); renderPropsLive(b); break;
      case 'in.opacity': state.ink.opacity = parseInt(b.value, 10) / 100; renderPropsLive(b); break;
      case 'in.color': state.ink.color = b.value; break;
      case 'in.clear': clearInk(); break;
    }
  } else if (act.startsWith('doc.')) {
    switch (act) {
      case 'doc.saveproj': saveProjectFile(); break;
      case 'doc.openproj': $('#projectInput').click(); break;
    }
  }
}
function renderPropsLive(b) {
  const sp = b.parentElement.querySelector('span:last-child');
  if (sp) sp.textContent = b.value;
}
function onPropsChange(b) {
  const act = b.dataset.act;
  if (!act) return;
  const o = selObj();
  if (act === 'doc.ref') { toggleRef(); return; }
  if (act === 'doc.lang') {
    state.ocrLang = b.value;
    toast('OCR language set — naye uploads ke liye (existing page ke liye "Re-run OCR")', 'info', 3200);
    return;
  }
  if (act.startsWith('in.')) {
    switch (act) {
      case 'in.brush': state.brushSize = parseInt(b.value, 10); break;
      case 'in.width': state.ink.width = parseInt(b.value, 10); break;
      case 'in.opacity': state.ink.opacity = parseInt(b.value, 10) / 100; break;
      case 'in.color': state.ink.color = b.value; break;
      default: return;
    }
    renderProps();
    return;
  }
  if (act.startsWith('sp.') && o && state.sel.type === 'text') {
    const pre = commit();
    switch (act) {
      case 'sp.font': o.font = b.value; break;
      case 'sp.fs': o.fs = clamp(parseFloat(b.value) || o.fs, 6, 300); break;
      case 'sp.color': o.color = b.value; break;
      case 'sp.hl': o.bg = b.value; break;
      case 'sp.bg': o.bg = b.value; break;
      case 'sp.lh': o.lh = parseFloat(b.value) || 1.28; break;
      case 'sp.ls': o.ls = parseFloat(b.value) || 0; break;
      case 'sp.rot': o.rot = clamp(parseFloat(b.value) || 0, -360, 360); break;
      case 'sp.x': o.x = parseFloat(b.value) || 0; break;
      case 'sp.y': o.y = parseFloat(b.value) || 0; break;
      case 'sp.border': o.border = b.checked ? { w: 2, c: (b.closest('.p-row').querySelector('[data-act=sp.borderc]')?.value) || '#2563eb' } : null; break;
      case 'sp.borderc': if (o.border) { o.border.c = b.value; } break;
      case 'sp.shadow': o.shadow = b.checked ? (b.closest('.p-row').querySelector('[data-act=sp.shadoww]')?.value || 8) : 0; break;
      case 'sp.shadoww': if (o.shadow) o.shadow = parseInt(b.value, 10); break;
      case 'sp.tshadow': o.tshadow = b.checked ? (b.closest('.p-row').querySelector('[data-act=sp.tshadoww]')?.value || 2) : 0; break;
      case 'sp.tshadoww': if (o.tshadow) o.tshadow = parseInt(b.value, 10); break;
      default: return;
    }
    pushHistory(pre);
    applySpanStyle(o);
    updateMeasurements(curPage());
    redrawFills(curPage());
    refreshSelectionUI(curPage());
    renderProps();
    syncFmtBar();
    return;
  }
  if (act.startsWith('im.') && o && state.sel.type === 'image') {
    const pre = commit();
    switch (act) {
      case 'im.opacity': o.opacity = clamp(parseInt(b.value, 10) / 100, 0.05, 1); break;
      case 'im.rot': o.rot = clamp(parseFloat(b.value) || 0, -360, 360); break;
      case 'im.w': o.w = clamp(parseFloat(b.value) || o.w, 8, 6000); break;
      case 'im.h': o.h = clamp(parseFloat(b.value) || o.h, 8, 6000); break;
      case 'im.lock': o.lockAspect = b.checked !== false; break;
      case 'im.border': o.border = b.checked ? { w: 2, c: (b.closest('.p-row').querySelector('[data-act=im.borderc]')?.value) || '#2563eb' } : null; break;
      case 'im.borderc': if (o.border) o.border.c = b.value; break;
      default: return;
    }
    pushHistory(pre);
    applyImgStyle(o);
    refreshSelectionUI(curPage());
    renderProps();
    return;
  }
}

/* ---------------- menus ---------------- */
function uploadMenuItems() {
  return [
    { icon: 'upload', label: 'From device (PDF / Image)', act: () => $('#fileInput').click() },
    { icon: 'camera', label: 'Camera se document scan', act: () => $('#cameraInput').click() },
    { icon: 'open', label: 'Import project (JSON)', act: () => $('#projectInput').click() },
    { sep: 1 },
    { icon: 'filePlus', label: 'New blank document', act: openAddPage },
  ];
}
function pageMenuItems() {
  const p = curPage();
  return [
    { icon: 'plus', label: 'Add blank page…', act: openAddPage },
    { icon: 'copy', label: 'Duplicate page', act: duplicatePage },
    { icon: 'rotateCw', label: 'Rotate page 90°', act: rotatePage90 },
    { sep: 1 },
    { icon: 'undo', label: 'Move page up', act: () => movePage(-1), active: false },
    { icon: 'redo', label: 'Move page down', act: () => movePage(1) },
    { sep: 1 },
    { icon: 'fit', label: 'Fit to screen', act: fitZoom },
    { icon: 'trash', label: 'Delete page', act: deletePage, danger: true },
  ];
}
function eraseMenuItems() {
  const items = [
    { icon: 'target', label: 'Smart Eraser (selected text)', act: () => { state.tool = 'erase'; state.eraserMode = 'smart'; setTool('erase'); }, active: state.tool === 'erase' && state.eraserMode === 'smart' },
    { icon: 'eraser', label: 'White/Background brush', act: () => { state.tool = 'erase'; state.eraserMode = 'brush'; setTool('erase'); }, active: state.tool === 'erase' && state.eraserMode === 'brush' },
    { icon: 'square', label: 'Rectangle clean selection', act: () => { state.tool = 'erase'; state.eraserMode = 'rect'; setTool('erase'); }, active: state.tool === 'erase' && state.eraserMode === 'rect' },
    { icon: 'circle', label: 'Lasso clean selection', act: () => { state.tool = 'erase'; state.eraserMode = 'lasso'; setTool('erase'); }, active: state.tool === 'erase' && state.eraserMode === 'lasso' },
  ];
  return items;
}
function drawMenuItems() {
  const mk = (tool, iconN, label) => ({ icon: iconN, label, act: () => { state.inkTool = tool; setTool('ink'); }, active: state.tool === 'ink' && state.inkTool === tool });
  return [
    mk('pen', 'pen', 'Pen'),
    mk('marker', 'marker', 'Marker'),
    mk('highlighter', 'highlighter', 'Highlighter'),
    { sep: 1 },
    mk('line', 'line', 'Line'),
    mk('arrow', 'arrow', 'Arrow'),
    mk('rect', 'square', 'Rectangle'),
    mk('circle', 'circle', 'Circle / Ellipse'),
    { sep: 1 },
    mk('signature', 'sign', 'Signature'),
    { sep: 1 },
    { icon: 'trash', label: 'Clear all drawings', act: clearInk, danger: true },
  ];
}
function shareMenuItems() {
  const item = (iconN, label, kind) => ({ icon: iconN, label, act: () => shareAction(kind) });
  return [
    item('download', 'Download file', 'download'),
    item('share', 'Share (native share sheet)', 'share'),
    item('whatsapp', 'Send on WhatsApp', 'whatsapp'),
    item('link', 'Copy link', 'copy'),
    item('mail', 'Email', 'email'),
    item('saveDevice', 'Save to device', 'save'),
  ];
}

/* ---------------- export dialog ---------------- */
function defaultFormat() {
  const ext = (state.sourceExt || '').toLowerCase();
  if (state.sourceType === 'pdf' || ext === 'pdf') return 'pdf-flat';
  if (['jpg', 'jpeg'].includes(ext)) return 'jpg';
  return 'png';
}
function openExport() {
  if (!state.pages.length) return toast('Pehle document upload karein', 'warn', 2600);
  state.lastExport = null;
  const fmt = defaultFormat();
  $('#exportBody').innerHTML = `
    <div class="f-field"><label>Format</label><select id="expFormat">
      <option value="pdf-flat" ${fmt === 'pdf-flat' ? 'selected' : ''}>PDF — flattened (pixel-perfect)</option>
      <option value="pdf-edit" ${fmt === 'pdf-edit' ? 'selected' : ''}>PDF — editable (selectable text)</option>
      <option value="png" ${fmt === 'png' ? 'selected' : ''}>PNG (lossless)</option>
      <option value="jpg" ${fmt === 'jpg' ? 'selected' : ''}>JPG (small size)</option>
    </select></div>
    <div class="f-field"><label>Pages</label><select id="expPages">
      <option value="all" ${state.pages.length <= 1 ? 'selected' : ''}>Saare pages (${state.pages.length})</option>
      <option value="cur">Sirf current page (${state.cur + 1})</option>
    </select></div>
    <div class="f-field"><label>Quality</label><select id="expQ">
      <option value="1">Original quality (2×)</option>
      <option value="0">Compressed (chhota size)</option>
    </select></div>
    <div class="f-field"><label>File name</label><input type="text" id="expName" value="${esc(state.baseName)}-edited"></div>
    <label class="f-check"><input type="checkbox" id="expRef"> Original text background me hi rakhein (editable text ke neeche — double text dikhega)</label>
    <p class="p-hint" style="margin-bottom:10px">Default: original text clean hota hai aur editable text layers uski jagah export hote hain (clean document). Tip: export se pehle Preview mode me final check karein. Original file kabhi overwrite nahi hoti — edited version ka naam "-edited" hota hai.</p>
    <button class="btn primary" id="expGo" style="width:100%">${icon('download')} Export karein</button>
    <div id="expProg" class="exp-progress hidden">
      <div class="ocr-bar"><div id="expBar" class="ocr-fill"></div></div>
      <p id="expStatus" class="p-hint" style="margin-top:6px">Preparing…</p>
    </div>
    <div id="expResult" class="exp-result hidden"></div>`;
  $('#expGo').addEventListener('click', runExportDialog);
  openModal('exportModal');
}
function setExpProg(frac, msg) {
  $('#expProg').classList.remove('hidden');
  $('#expBar').style.width = clamp(frac * 100, 0, 100) + '%';
  if (msg) $('#expStatus').textContent = msg;
}
async function runExportDialog() {
  const opts = {
    format: $('#expFormat').value,
    pages: $('#expPages').value,
    quality: $('#expQ').value,
    name: ($('#expName').value || 'document').replace(/[\\/:*?"<>|]/g, '_'),
    showRef: $('#expRef').checked,
  };
  const btn = $('#expGo');
  btn.disabled = true;
  const resEl = $('#expResult');
  resEl.classList.add('hidden');
  resEl.innerHTML = '';
  try {
    const out = await runExport(opts, setExpProg);
    state.lastExport = out;
    const sizeMb = (out.blob.size / 1048576).toFixed(1);
    resEl.innerHTML = `
      <h4>${icon('check')} Export successful — ${esc(out.name)} (${sizeMb} MB)</h4>
      <div class="share-row">
        <button class="share-btn dl" data-share="download">${icon('download')} Download</button>
        <button class="share-btn wa" data-share="whatsapp">${icon('whatsapp')} WhatsApp</button>
        <button class="share-btn" data-share="share">${icon('share')} Share</button>
        <button class="share-btn" data-share="copy">${icon('link')} Copy link</button>
        <button class="share-btn" data-share="email">${icon('mail')} Email</button>
        <button class="share-btn" data-share="save">${icon('saveDevice')} Save to device</button>
      </div>`;
    resEl.classList.remove('hidden');
    resEl.querySelectorAll('[data-share]').forEach(b => b.addEventListener('click', () => shareAction(b.dataset.share)));
    setExpProg(1, 'Complete ✓ — ab download ya share karein');
    toast('Export complete: ' + out.name, 'success', 3200);
  } catch (e) {
    console.error(e);
    setExpProg(0, 'Export failed, please try again');
    toast('Export failed, please try again', 'error', 4500);
  } finally {
    btn.disabled = false;
  }
}
async function runExport(opts, onProgress) {
  const S = opts.quality === '1' ? 2 : 1.2;
  const q = opts.quality === '1' ? 0.92 : 0.78;
  const isPdf = opts.format === 'pdf-flat' || opts.format === 'pdf-edit';
  const ext = opts.format === 'png' ? 'png' : opts.format === 'jpg' ? 'jpg' : 'pdf';
  const mime = opts.format === 'png' ? 'image/png' : opts.format === 'jpg' ? 'image/jpeg' : 'application/pdf';
  const idxs = opts.pages === 'cur' ? [state.cur] : state.pages.map((_, i) => i);
  const origCur = state.cur;
  const results = [];
  for (let i = 0; i < idxs.length; i++) {
    const pi = idxs[i];
    onProgress(i / idxs.length, `Page ${pi + 1} / ${idxs.length} render ho raha hai…`);
    if (pi !== state.cur) goPage(pi);
    const page = curPage();
    await getBgImg(page);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const cv = await compositePage(page, { scale: S, showRef: opts.showRef, skipText: opts.format === 'pdf-edit' });
    if (isPdf) {
      results.push({ ptW: page.ptW, ptH: page.ptH, imgDataUrl: cv.toDataURL('image/jpeg', q), page });
    } else {
      const blob = await canvasToBlob(cv, mime, q);
      const nm = idxs.length === 1 ? `${opts.name}.${ext}` : `${opts.name}-page-${pi + 1}.${ext}`;
      results.push({ blob, name: nm });
    }
  }
  goPage(origCur);
  if (isPdf) {
    onProgress(0.85, 'PDF ban raha hai…');
    const edit = opts.format === 'pdf-edit';
    if (edit && hasNonLatin(results.map(r => r.page))) {
      toast('Hindi/Devanagari text editable PDF me standard fonts se nahi likha ja sakta — Flattened PDF export kiya gaya (text visible rahega)', 'warn', 6500);
    }
    const blob = await buildPdf({
      pages: results,
      mode: edit && !hasNonLatin(results.map(r => r.page)) ? 'edit' : 'flat',
    }, (f) => onProgress(0.85 + f * 0.15, 'PDF ban raha hai…'));
    return { blob, name: `${opts.name}.pdf`, mime };
  }
  if (results.length === 1) return results[0];
  onProgress(0.95, 'ZIP ban raha hai…');
  const blob = await buildZip(results, (f) => onProgress(0.95 + f * 0.05, 'ZIP ban raha hai…'));
  return { blob, name: `${opts.name}-pages.zip`, mime: 'application/zip' };
}
async function shareAction(kind) {
  const exp = state.lastExport;
  if (!exp) { openExport(); return; }
  const { blob, name } = exp;
  try {
    if (kind === 'download' || kind === 'save') downloadBlob(blob, name);
    else if (kind === 'share') await downloadAndShare(blob, name);
    else if (kind === 'whatsapp') await whatsapp(blob, name);
    else if (kind === 'copy') await copyLink(blob, name);
    else if (kind === 'email') emailShare(name);
  } catch (e) {
    console.error(e);
    toast('Share fail hua — dobara try karein', 'error');
  }
}

/* ---------------- keyboard ---------------- */
function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    const editing = isEditingText();
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 's') { e.preventDefault(); saveProjectFile(); return; }
    if (mod && k === 'e') { e.preventDefault(); openExport(); return; }
    if (editing) {
      if (e.key === 'Escape') { e.preventDefault(); endEditIfAny(); }
      else if (mod && e.key === 'Enter') { e.preventDefault(); endEditIfAny(); }
      return;
    }
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 'c') { if (state.sel) { e.preventDefault(); copySel(); } return; }
    if (mod && k === 'x') { if (state.sel) { e.preventDefault(); cutSel(); } return; }
    if (mod && k === 'v') { if (state.sel || state.pages.length) { e.preventDefault(); pasteClip(); } return; }
    if (mod && k === 'd') { e.preventDefault(); dupeSel(); return; }
    if (mod && k === 'b') { const o = selObj(); if (o && state.sel.type === 'text') { e.preventDefault(); doFmt('bold'); } return; }
    if (mod && k === 'i') { const o = selObj(); if (o && state.sel.type === 'text') { e.preventDefault(); doFmt('italic'); } return; }
    if (mod && k === 'u') { const o = selObj(); if (o && state.sel.type === 'text') { e.preventDefault(); doFmt('underline'); } return; }
    if (e.key === 'Escape') {
      if (lassoPts) lassoClear();
      else select(null);
      closeMenu();
      return;
    }
    if (e.key === 'Enter' && state.tool === 'erase' && state.eraserMode === 'lasso' && lassoPts) { lassoFinish(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.sel) { e.preventDefault(); deleteSel(); return; }
    if (e.key === 'ArrowLeft' && state.sel) { e.preventDefault(); nudgeSel(e.shiftKey ? -10 : -1, 0); return; }
    if (e.key === 'ArrowRight' && state.sel) { e.preventDefault(); nudgeSel(e.shiftKey ? 10 : 1, 0); return; }
    if (e.key === 'ArrowUp' && state.sel) { e.preventDefault(); nudgeSel(0, e.shiftKey ? -10 : -1); return; }
    if (e.key === 'ArrowDown' && state.sel) { e.preventDefault(); nudgeSel(0, e.shiftKey ? 10 : 1); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(state.zoom * 1.15); return; }
    if (e.key === '-') { e.preventDefault(); setZoom(state.zoom / 1.15); return; }
    if (k === '0' && !mod) { fitZoom(); return; }
    if (k === 'v' && !mod) { setTool('select'); return; }
    if (k === 't' && !mod) { setTool('text'); return; }
    if (k === 'e' && !mod) { state.tool = 'erase'; state.eraserMode = state.eraserMode; setTool('erase'); return; }
    if (k === 'p' && !mod) { state.inkTool = 'pen'; setTool('ink'); return; }
    if (k === 'f' && !mod) { fitZoom(); return; }
  });
  document.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });
  document.addEventListener('keydown', (e) => {
    if (e.key === ' ' && !isEditingText()) { spaceDown = true; const p = curPage(); if (p && p._el) p._el.sheet.style.cursor = 'grab'; }
  });
  document.addEventListener('selectionchange', () => {
    const o = selObj();
    if (o && o._editing && state.sel.type === 'text') syncFmtBar();
  });
}

/* ---------------- viewport wiring (pinch, pan, wheel) ---------------- */
function wireViewport() {
  const se = scrollEl();
  se.addEventListener('pointerdown', (e) => {
    ptMap.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptMap.size === 1 && (e.target === se || e.target.id === 'pagesArea' || e.target.classList.contains('page-wrap'))) {
      const p = curPage();
      if (p && !state.preview && state.tool === 'select' && !e.target.closest('.td-span, .td-img')) {
        gesture.type = 'pan';
        gesture.page = p;
        gesture.sx = e.clientX; gesture.sy = e.clientY;
        gesture.sl = se.scrollLeft; gesture.st = se.scrollTop;
        gesture.moved = false;
        gesture.tapDeselect = true;
      }
    }
    if (ptMap.size === 2) {
      cancelGesture();
      const p = curPage();
      if (!p) return;
      const [a, b] = [...ptMap.values()];
      const r = p._el.sheet.getBoundingClientRect();
      gesture.type = 'pinch';
      gesture.page = p;
      gesture.start = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        zoom: state.zoom,
        px: ((a.x + b.x) / 2 - r.left) / state.zoom,
        py: ((a.y + b.y) / 2 - r.top) / state.zoom,
        sl: se.scrollLeft, st: se.scrollTop,
      };
    }
  }, { capture: true });
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', (e) => {
    ptMap.delete(e.pointerId);
    if (gesture.type === 'pinch') { if (ptMap.size < 2) gesture.type = null; return; }
    endGesture();
  });
  window.addEventListener('pointercancel', (e) => {
    ptMap.delete(e.pointerId);
    cancelGesture();
  });
  se.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const p = curPage();
    if (!p) return;
    const r = p._el.sheet.getBoundingClientRect();
    const px = (e.clientX - r.left) / state.zoom;
    const py = (e.clientY - r.top) / state.zoom;
    const z2 = clamp(state.zoom * (e.deltaY < 0 ? 1.12 : 0.89), 0.2, 4);
    const cx = r.left + px * state.zoom, cy = r.top + py * state.zoom;
    setZoom(z2);
    const r2 = p._el.sheet.getBoundingClientRect();
    se.scrollLeft += (r2.left + px * z2) - cx;
    se.scrollTop += (r2.top + py * z2) - cy;
  }, { passive: false });
}

/* ---------------- thumbnails ---------------- */
function wireThumbs() {
  const box = $('#thumbs');
  box.addEventListener('click', (e) => {
    const del = e.target.closest('.tdel');
    const item = e.target.closest('.thumb');
    if (!item) return;
    const idx = parseInt(item.dataset.idx, 10);
    if (del) {
      e.stopPropagation();
      const saved = state.cur;
      goPage(idx);
      deletePage();
      return;
    }
    if (idx !== state.cur) goPage(idx);
  });
  let dragIdx = null;
  box.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.thumb');
    if (!item) return;
    dragIdx = parseInt(item.dataset.idx, 10);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(dragIdx)); } catch (err) {}
  });
  box.addEventListener('dragover', (e) => {
    if (dragIdx === null) return;
    e.preventDefault();
    const item = e.target.closest('.thumb');
    box.querySelectorAll('.thumb').forEach(t => t.classList.remove('drag-over'));
    if (item) item.classList.add('drag-over');
  });
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    const item = e.target.closest('.thumb');
    const to = item ? parseInt(item.dataset.idx, 10) : state.pages.length - 1;
    if (dragIdx !== null) reorderPages(dragIdx, to);
    dragIdx = null;
    box.querySelectorAll('.thumb').forEach(t => t.classList.remove('drag-over'));
  });
  box.addEventListener('dragend', () => {
    dragIdx = null;
    box.querySelectorAll('.thumb').forEach(t => t.classList.remove('drag-over'));
  });
}
async function renderThumbs() {
  const box = $('#thumbs');
  box.innerHTML = '';
  for (let i = 0; i < state.pages.length; i++) {
    const p = state.pages[i];
    const item = el(`<div class="thumb ${i === state.cur ? 'active' : ''}" draggable="true" data-idx="${i}" title="Page ${i + 1} — click to open, drag to reorder">
      <canvas></canvas><span class="tnum">${i + 1}</span>
      ${p.rot90 === 1 || p.rot90 === 3 ? '<span class="rotbadge">↻</span>' : ''}
      <button class="tdel" title="Delete page ${i + 1}">✕</button></div>`);
    box.appendChild(item);
    const cv = item.querySelector('canvas');
    const tw = 108, th = Math.max(40, Math.round(tw * p.h / p.w));
    cv.width = tw; cv.height = th;
    try {
      const img = await getBgImg(p);
      const c = cv.getContext('2d');
      c.fillStyle = '#fff'; c.fillRect(0, 0, tw, th);
      if (img.width) c.drawImage(img, 0, 0, tw, th);
    } catch (e) {}
  }
}

/* ---------------- page indicator ---------------- */
function updatePageIndicator() {
  const elp = $('#pageIndicator');
  if (!state.pages.length) { elp.classList.add('hidden'); return; }
  elp.classList.remove('hidden');
  const p = curPage();
  elp.innerHTML = `Page <b>${state.cur + 1}</b> / ${state.pages.length} • ${sizeLabel(p)} • ${Math.round(state.zoom * 100)}%`;
}

/* ---------------- help ---------------- */
function fillHelp() {
  $('#helpBody').innerHTML = `
  <div class="help-sec"><h4>Quick flow</h4><ul>
    <li><b>Upload</b> — PDF, PNG/JPG/WEBP image, screenshot ya camera scan</li>
    <li><b>OCR</b> — Hindi/English/Hinglish text automatically editable ban jata hai (progress ke saath)</li>
    <li><b>Edit</b> — text par click karke select, double-click karke type karein; toolbar se Bold/Italic/A+/A- etc.</li>
    <li><b>Erase</b> — Smart Eraser se text hataayein (background auto-match), ya brush/rect/lasso se kisi bhi area ko clean karein</li>
    <li><b>Add</b> — naya text, image/logo (crop, flip, opacity, circle), drawing &amp; signature</li>
    <li><b>Pages</b> — add/duplicate/delete/rotate/reorder, A4/Letter/Legal/custom sizes</li>
    <li><b>Preview → Export</b> — PDF/PNG/JPG/ZIP, phir Download / WhatsApp / Share / Email</li>
  </ul></div>
  <div class="help-sec"><h4>Keyboard shortcuts</h4><ul>
    <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> — Undo / Redo</li>
    <li><kbd>Ctrl</kbd>+<kbd>B</kbd>/<kbd>I</kbd>/<kbd>U</kbd> — Bold / Italic / Underline</li>
    <li><kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>X</kbd>/<kbd>V</kbd>/<kbd>D</kbd> — Copy / Cut / Paste / Duplicate</li>
    <li><kbd>Delete</kbd> — selected text/image delete</li>
    <li><kbd>↑↓←→</kbd> (Shift = 10px) — move selected object</li>
    <li><kbd>Ctrl</kbd>+<kbd>S</kbd> — save project file • <kbd>Ctrl</kbd>+<kbd>E</kbd> — export</li>
    <li><kbd>V</kbd> select • <kbd>T</kbd> text • <kbd>E</kbd> eraser • <kbd>P</kbd> pen • <kbd>F</kbd> fit • <kbd>0</kbd> fit • <kbd>+</kbd>/<kbd>−</kbd> zoom</li>
    <li><kbd>Space</kbd>+drag ya middle-mouse — pan • Ctrl+wheel — zoom at cursor • mobile: 2-finger pinch = zoom</li>
  </ul></div>
  <div class="help-sec"><h4>Privacy &amp; tips</h4><ul>
    <li>🔒 Saari processing aapke browser me hoti hai — files kahin upload nahi hoti, koi public URL nahi banta</li>
    <li>Original file kabhi overwrite nahi hoti — export ka naam "-edited" hota hai</li>
    <li>Orange dashed border = kam confidence OCR text — click karke manually correct karein</li>
    <li>"Eye" button se original text hide/show (clean view vs reference view)</li>
    <li>Unsaved changes ke saath refresh karne par warning milegi; draft auto-save bhi hota hai</li>
  </ul>`;
}

/* ---------------- action dispatch ---------------- */
function onAct(act, b) {
  switch (act) {
    case 'upload': $('#fileInput').click(); break;
    case 'camera': $('#cameraInput').click(); break;
    case 'project': $('#projectInput').click(); break;
    case 'menu:upload': openMenu(b, uploadMenuItems()); break;
    case 'menu:page': if (state.pages.length) openMenu(b, pageMenuItems()); break;
    case 'menu:erase': openMenu(b, eraseMenuItems()); break;
    case 'menu:draw': openMenu(b, drawMenuItems()); break;
    case 'tool:select': setTool('select'); break;
    case 'tool:text': setTool('text'); break;
    case 'pickImage': pickImage(); break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'zoom-in': setZoom(state.zoom * 1.2); break;
    case 'zoom-out': setZoom(state.zoom / 1.2); break;
    case 'fit': fitZoom(); break;
    case 'preview': togglePreview(); break;
    case 'export-open': openExport(); break;
    case 'share': openMenu(b, shareMenuItems()); break;
    case 'help': fillHelp(); openModal('helpModal'); break;
    case 'props-open': { const pp = $('#propsPanel'); if (pp) { pp.classList.toggle('open'); } break; }
    case 'page-add': openAddPage(); break;
    case 'page-add-confirm': confirmAddPage(); break;
    case 'toggleRef': toggleRef(); break;
    case 'draft-restore': restoreDraft(); break;
    case 'draft-discard': discardDraft(); break;
    case 'crop-preset': cropPreset(b.dataset.val); break;
    case 'crop-apply': applyCrop(); break;
    case 'crop-reset': { const c = $('#cropBox'); if (c) { crop.sx = 0; crop.sy = 0; crop.sw = crop.img ? crop.img.width : 0; crop.sh = crop.img ? crop.img.height : 0; positionCropBox(); } break; }
    default:
      if (act.startsWith('fmt:')) {
        const fmt = act.slice(4);
        doFmt(fmt, b);
      }
  }
}

/* ---------------- chrome building ---------------- */
function buildChrome() {
  const tb = $('#mainToolbar');
  const defs = [
    { act: 'menu:upload', icon: 'upload', title: 'Upload PDF / Image / Camera', lbl: 'Upload' },
    { act: 'menu:page', icon: 'page', title: 'Page management (add, duplicate, rotate, delete, reorder)' },
    { sep: 1 },
    { act: 'tool:select', icon: 'cursor', title: 'Select & move (V)' },
    { act: 'tool:text', icon: 'text', title: 'Add new text (T)' },
    { act: 'menu:erase', icon: 'eraser', title: 'Erase tools — Smart / Brush / Rectangle / Lasso (E)' },
    { act: 'pickImage', icon: 'image', title: 'Insert image / logo (gallery ya file manager se)' },
    { act: 'menu:draw', icon: 'pen', title: 'Draw & annotate — pen, marker, highlighter, shapes, signature (P)' },
    { sep: 1 },
    { act: 'undo', icon: 'undo', title: 'Undo (Ctrl+Z)' },
    { act: 'redo', icon: 'redo', title: 'Redo (Ctrl+Y)' },
    { sep: 1 },
    { act: 'toggleRef', icon: 'eye', title: 'Original text show/hide (reference mode)' },
  ];
  tb.innerHTML = '';
  for (const d of defs) {
    if (d.sep) { tb.appendChild(el('<div class="tb-sep"></div>')); continue; }
    tb.appendChild(el(`<button class="tbtn" data-act="${d.act}" title="${esc(d.title)}">${icon(d.icon)}${d.lbl ? `<span class="lbl">${d.lbl}</span>` : ''}</button>`));
  }
  $('#fitIco').innerHTML = icon('fit');
  $('#previewBtn').innerHTML = icon('lock');
  $('#exportIco').innerHTML = icon('download');
  document.querySelector('[data-act="share"]').innerHTML = icon('share');
  document.querySelector('[data-act="help"]').innerHTML = icon('help');
  $('#mi-select').innerHTML = icon('cursor');
  $('#mi-text').innerHTML = icon('text');
  $('#mi-eraser').innerHTML = icon('eraser');
  $('#mi-image').innerHTML = icon('image');
  $('#mi-pen').innerHTML = icon('pen');
  $('#mi-undo').innerHTML = icon('undo');
  $('#mi-redo').innerHTML = icon('redo');
  $('#mi-export').innerHTML = icon('download');
  $('#dzIco').innerHTML = icon('upload');

  // format bar
  const b = $('#formatBar');
  const fonOpts = FOND.map(f => `<option value="${esc(f)}">${f.split(',')[0]}</option>`).join('');
  b.innerHTML = `
   <div class="fmt-grp">
     <select class="fsel" data-fmt="font" title="Font family" aria-label="Font family">${fonOpts}</select>
     <button class="fbtn" data-fmt="a-" title="Text chhota (A−)">A−</button>
     <input class="fnum" type="number" data-fmt="fs" min="6" max="300" title="Font size" aria-label="Font size">
     <button class="fbtn" data-fmt="a+" title="Text bada (A+)">A+</button>
   </div>
   <div class="fmt-sep"></div>
   <div class="fmt-grp">
     <button class="fbtn" data-fmt="bold" title="Bold (Ctrl+B)"><span class="txt-ico">B</span></button>
     <button class="fbtn" data-fmt="italic" title="Italic (Ctrl+I)"><span class="txt-ico i">I</span></button>
     <button class="fbtn" data-fmt="underline" title="Underline (Ctrl+U)"><span class="txt-ico u">U</span></button>
     <button class="fbtn" data-fmt="strike" title="Strikethrough"><span class="txt-ico s">S</span></button>
   </div>
   <div class="fmt-sep"></div>
   <div class="fmt-grp">
     <span class="fcolor" title="Text color"><span class="swatch" id="swColor" style="background:#111827"></span><input type="color" data-fmt="color" value="#111827" aria-label="Text color"></span>
     <span class="fcolor" title="Text highlight color"><span class="swatch" id="swHl" style="background:#fef08a"></span><input type="color" data-fmt="hl" value="#fef08a" aria-label="Highlight color"></span>
     <span class="fcolor" title="Text box background"><span class="swatch" id="swBg" style="background:transparent;border:1px dashed #94a3b8"></span><input type="color" data-fmt="bg" value="#ffffff" aria-label="Background color"></span>
   </div>
   <div class="fmt-sep"></div>
   <div class="fmt-grp">
     <button class="fbtn" data-fmt="align" data-val="left" title="Align left">${icon('alignL')}</button>
     <button class="fbtn" data-fmt="align" data-val="center" title="Align center">${icon('alignC')}</button>
     <button class="fbtn" data-fmt="align" data-val="right" title="Align right">${icon('alignR')}</button>
     <button class="fbtn" data-fmt="align" data-val="justify" title="Justify">${icon('alignJ')}</button>
   </div>
   <div class="fmt-sep"></div>
   <div class="fmt-grp">
     <select class="fsel" data-fmt="lh" title="Line spacing" aria-label="Line spacing"><option value="0.9">0.9×</option><option value="1">1×</option><option value="1.15">1.15×</option><option value="1.28" selected>1.28×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>
     <select class="fsel" data-fmt="ls" title="Letter spacing" aria-label="Letter spacing"><option value="-1">−1px</option><option value="0" selected>0px</option><option value="0.5">0.5px</option><option value="1">1px</option><option value="2">2px</option></select>
   </div>
   <div class="fmt-sep"></div>
   <div class="fmt-grp">
     <button class="fbtn" data-fmt="upper" title="UPPERCASE">AA</button>
     <button class="fbtn" data-fmt="lower" title="lowercase">aa</button>
     <button class="fbtn" data-fmt="sup" title="Superscript">A<sup>2</sup></button>
     <button class="fbtn" data-fmt="sub" title="Subscript">A<sub>2</sub></button>
     <button class="fbtn" data-fmt="ul" title="Bulleted list (edit mode me)">${icon('ul')}</button>
     <button class="fbtn" data-fmt="ol" title="Numbered list (edit mode me)">${icon('ol')}</button>
   </div>`;
  b.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fmt]');
    if (btn && btn.tagName === 'BUTTON') onAct('fmt:' + btn.dataset.fmt, btn);
  });
  b.addEventListener('change', (e) => {
    const c = e.target.closest('[data-fmt]');
    if (c) onAct('fmt:' + c.dataset.fmt, c);
  });
}

/* ---------------- inputs & landing ---------------- */
function wireInputs() {
  $('#fileInput').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  $('#cameraInput').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  $('#imageInput').addEventListener('change', (e) => { handleInsertImage(e.target.files[0]); e.target.value = ''; });
  $('#replaceInput').addEventListener('change', (e) => { handleInsertImage(e.target.files[0]); e.target.value = ''; });
  $('#projectInput').addEventListener('change', (e) => { importProject(e.target.files[0]); e.target.value = ''; });
  const dz = $('#dropzone');
  dz.addEventListener('click', (e) => { if (!e.target.closest('button')) $('#fileInput').click(); });
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fileInput').click(); } });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
  ['dragenter', 'dragover'].forEach(ev => {
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); });
    $('#canvasScroll').addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('drag')));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag'); handleFiles(e.dataTransfer.files); });
  $('#canvasScroll').addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
  const sg = $('#sizeGrid');
  sg.addEventListener('change', () => {
    const v = document.querySelector('input[name=pagesize]:checked').value;
    $('#customSizeRow').classList.toggle('hidden', v !== 'custom');
  });
  document.addEventListener('click', (e) => {
    const bb = e.target.closest('[data-act]');
    if (bb) onAct(bb.dataset.act, bb);
    const fmt = e.target.closest('[data-fmt]');
    if (fmt && fmt.tagName === 'BUTTON') { /* handled by formatbar listener */ }
  });
  // props panel delegation
  const pp = $('#propsPanel');
  pp.addEventListener('click', (e) => { const bb = e.target.closest('[data-act]'); if (bb) onPropsClick(bb); });
  pp.addEventListener('change', (e) => { const bb = e.target.closest('[data-act]'); if (bb) onPropsChange(bb); });
  wireCrop();
  wireThumbs();
}
async function importProject(file) {
  if (!file) return;
  try {
    const txt = await file.text();
    const d = JSON.parse(txt);
    if (!d || !Array.isArray(d.pages) || !d.pages.length) throw new Error('invalid');
    state.baseName = d.baseName || baseFrom(file.name);
    state.sourceType = d.sourceType || null;
    state.showRef = d.showRef !== false;
    state.ocrLang = d.ocrLang || 'hin+eng';
    state.pages = d.pages.map(p => {
      if (p.bg) bgStore.set(p.id, p.bg);
      delete p.bg;
      return p;
    });
    state.cur = 0; state.sel = null; state.dirty = true;
    history.undo.length = 0; history.redo.length = 0;
    enterApp();
    renderAll();
    fitZoom();
    toast('Project load ho gaya — editing continue karein', 'success', 3500);
  } catch (e) {
    toast('File format supported nahi hai — valid SmartDoc project JSON chahiye', 'error', 4500);
  }
}

/* ---------------- init ---------------- */
function init() {
  buildChrome();
  bindCloseButtons();
  wireInputs();
  wireKeyboard();
  wireViewport();
  const d = loadDraftMeta();
  if (d && d.pages && d.pages.length) {
    $('#draftCard').classList.remove('hidden');
    $('#draftMeta').textContent = `${d.pages.length} pages • last edit: ${new Date(d.ts).toLocaleString()}`;
  }
  window.addEventListener('beforeunload', (e) => {
    if (state.dirty && state.pages.length) { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('resize', () => {
    if (state.fit && state.pages.length) fitZoom();
  });
}
init();
