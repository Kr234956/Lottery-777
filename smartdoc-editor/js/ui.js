/* ============ SmartDoc — UI utilities: icons, toasts, menus, helpers ============ */

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [17, 24, 39];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

/* Load a UMD script from CDN once */
const loadedScripts = new Map();
export function loadScript(url) {
  if (loadedScripts.has(url)) return loadedScripts.get(url);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => resolve(true);
    s.onerror = () => reject(new Error('Script load failed: ' + url));
    document.head.appendChild(s);
  });
  loadedScripts.set(url, p);
  return p;
}

/* ============ Icons (feather-style, stroke based) ============ */
const P = (d, extra = '') => `<path d="${d}"${extra}/>`;
export const ICONS = {
  upload: P('M12 16V4') + P('m6 9 6-5 6 5') + P('M4 20h16'),
  download: P('M12 4v12') + P('m6 10 6 6 6-6') + P('M4 20h16'),
  camera: P('M4 8h3.2L9 5h6l1.8 3H20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z') + '<circle cx="12" cy="13.5" r="3.4"/>',
  page: P('M6 2h8l5 5v15H6z') + P('M14 2v5h5'),
  cursor: P('m5 3 14 8.5-6.2 1.8L10 20z'),
  text: P('M5 6V4h14v2') + P('M12 4v16') + P('M9 20h6'),
  eraser: P('m7.5 20 11-11 3.5 3.5-11 11H7.5z') + P('M7.5 20H4l8.5-8.5') + P('m13 7.5 3.5-3.5L20 7.5 16.5 11'),
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/>' + '<circle cx="9" cy="10" r="1.8"/>' + P('m21 16.5-5-5L6 21'),
  pen: P('M17 3l4 4L8 20l-5 1 1-5z'),
  highlighter: P('m9 11 4 4L20.5 7.5 16.5 3.5 9 11z') + P('M9 11 3.5 16.5V20.5H7.5L13 15') + P('M16 14l3 3'),
  line: P('M5 19 19 5'),
  arrow: P('M5 19 19 5') + P('M11 5h8v8'),
  square: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  sign: P('M3 16c2.5-5 4 1.5 6.5-3.5S14 13 17 7') + P('M3 20.5h18'),
  undo: P('M4 10h11a5 5 0 0 1 0 10h-4') + P('M8 6 4 10l4 4'),
  redo: P('M20 10H9a5 5 0 0 0 0 10h4') + P('m16 6 4 4-4 4'),
  trash: P('M4 7h16') + P('M9 7V4h6v3') + P('m6 7 1 14h10l1-14') + P('M10 11v6M14 11v6'),
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/>' + P('M5 15V5a2 2 0 0 1 2-2h10'),
  cut: '<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/>' + P('M20 4 8.3 15.7') + P('M14.5 12.5 20 20'),
  crop: P('M6 2v16h16') + P('M2 6h16v16'),
  flipH: P('M12 3v18') + P('M8 8 4 12l4 4') + P('m16 8 4 4-4 4'),
  flipV: P('M3 12h18') + P('M8 8l4-4 4 4') + P('m8 16 4 4 4-4'),
  front: P('m12 3 9 5.2-9 5.2L3 8.2z') + P('m3 13.5 9 5.2 9-5.2'),
  back: P('m12 21 9-5.2-9-5.2L3 15.8z') + P('m3 10.2 9-5.2 9 5.2'),
  share: '<circle cx="6" cy="12" r="2.7"/><circle cx="18" cy="5.5" r="2.7"/><circle cx="18" cy="18.5" r="2.7"/>' + P('m8.4 10.7 7.2-4M8.4 13.3l7.2 4'),
  whatsapp: P('M21 12a9 9 0 1 1-4.6-7.8L21 3l-1.3 4.2A8.9 8.9 0 0 1 21 12z') + P('M9 9.3c0 4 5.7 6.7 5.7 6.7l1.6-1.6-2.1-1.5-1 .5c-1-.5-2-1.5-2.6-2.6l.5-1-1.5-2.1z'),
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/>' + P('m3 7.5 9 6 9-6'),
  link: P('M10 14a4.2 4.2 0 0 0 6.3.4l2.6-2.6a4.2 4.2 0 0 0-6-6L11.5 7.2') + P('M14 10a4.2 4.2 0 0 0-6.3-.4L5.1 12.2a4.2 4.2 0 0 0 6 6l1.4-1.4'),
  zoomIn: '<circle cx="11" cy="11" r="7"/>' + P('m21 21-4.5-4.5') + P('M8 11h6M11 8v6'),
  zoomOut: '<circle cx="11" cy="11" r="7"/>' + P('m21 21-4.5-4.5') + P('M8 11h6'),
  fit: P('M4 9V4h5') + P('M20 9V4h-5') + P('M4 15v5h5') + P('M20 15v5h-5'),
  rotateCw: P('M21 4v6h-6') + P('M20.5 10a8.5 8.5 0 1 0 .5 4.5') + P('M21 4l-2.5 2.5M21 4l-3 .8'),
  eye: P('M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z') + '<circle cx="12" cy="12" r="2.8"/>',
  eyeOff: P('M2 12s3.8-6.5 10-6.5c1.6 0 3 .4 4.3 1') + P('M22 12s-3.8 6.5-10 6.5c-1.6 0-3-.4-4.3-1') + P('m4 4 16 16'),
  save: P('M5 3h11l5 5v13H5z') + P('M8 3v5h8V3') + '<rect x="8" y="13" width="8" height="7"/>',
  open: P('M3 6h6l2 2.5h10V20H3z'),
  help: '<circle cx="12" cy="12" r="9"/>' + P('M9.4 9.2a2.7 2.7 0 1 1 3.7 2.5c-.9.4-1.1 1-1.1 1.9') + P('M12 17.2v.1'),
  check: P('m4.5 12.5 5 5L20 6.5'),
  x: P('M6 6l12 12M18 6 6 18'),
  alert: P('M12 3.5 2.5 20h19z') + P('M12 9.5v5') + P('M12 17.4v.1'),
  plus: P('M12 5v14M5 12h14'),
  refresh: P('M20 11a8 8 0 0 0-14.5-3.5L4 9') + P('M4 4v5h5') + P('M4 13a8 8 0 0 0 14.5 3.5L20 15') + P('M20 20v-5h-5'),
  saveDevice: P('M12 3v11') + P('m8 10 4 4 4-4') + P('M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3'),
  move: P('M12 3v18M3 12h18') + P('m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3'),
  alignL: P('M4 6h16M4 10h10M4 14h16M4 18h10'),
  alignC: P('M4 6h16M7 10h10M4 14h16M7 18h10'),
  alignR: P('M4 6h16M10 10h10M4 14h16M10 18h10'),
  alignJ: P('M4 6h16M4 10h16M4 14h16M4 18h16'),
  ul: P('M9 6h11M9 12h11M9 18h11') + P('M4.5 6h.1M4.5 12h.1M4.5 18h.1'),
  ol: P('M10 6h10M10 12h10M10 18h10') + P('M4 5.2h2V9M4 11.5h2.4l-2 3h2.4'),
  bold: P('M7 4h6a3.5 3.5 0 0 1 0 7H7zM7 11h7a3.5 3.5 0 0 1 0 7H7z'),
  marker: P('M4 20h16') + P('m6 16 9.5-9.5 3 3L9 19l-4 1z'),
  layers: P('m12 2 9 5-9 5-9-5z') + P('m3 12 9 5 9-5') + P('m3 17 9 5 9-5'),
  filePlus: P('M6 2h8l5 5v15H6z') + P('M14 2v5h5') + P('M12 11v6M9 14h6'),
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>' + P('M12 2v4M12 18v4M2 12h4M18 12h4'),
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/>' + P('M8 11V7a4 4 0 0 1 8 0v4'),
};
export function icon(name, cls = '') {
  const body = ICONS[name] || ICONS.page;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/* ============ Toasts ============ */
const TOAST_ICO = { success: 'check', error: 'alert', warn: 'alert', info: 'alert' };
export function toast(msg, type = 'info', ms = 3600) {
  const box = document.getElementById('toastBox');
  if (!box) return;
  const t = el(`<div class="toast ${type}">${icon(TOAST_ICO[type] || 'alert')}<span>${esc(msg)}</span></div>`);
  box.appendChild(t);
  while (box.children.length > 4) box.firstElementChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, ms);
}

/* ============ Menus (dropdowns) ============ */
let _menu = null;
function _menuDocDown(e) { if (_menu && !_menu.el.contains(e.target)) closeMenu(); }
function _menuKey(e) { if (e.key === 'Escape') closeMenu(); }
function _menuScroll() { closeMenu(); }
export function openMenu(anchor, items, opts = {}) {
  closeMenu();
  const layer = document.getElementById('menuLayer');
  const menu = el(`<div class="menu" role="menu"></div>`);
  for (const it of items) {
    if (it.sep) { menu.appendChild(el('<div class="menu-sep"></div>')); continue; }
    const b = el(`<button class="menu-item ${it.danger ? 'danger' : ''} ${it.active ? 'active' : ''}" role="menuitem">
        <span class="mi-ico">${it.icon ? icon(it.icon) : ''}</span><span class="mi-label">${it.label}</span>
        ${it.key ? `<span class="mkey">${it.key}</span>` : ''}${it.active ? icon('check') : ''}</button>`);
    b.addEventListener('click', () => { closeMenu(); it.act && it.act(); });
    menu.appendChild(b);
  }
  layer.appendChild(menu);
  layer.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = r.left, top = r.bottom + 6;
  if (opts.up) top = r.top - mh - 6;
  if (left + mw > innerWidth - 8) left = innerWidth - mw - 8;
  if (left < 8) left = 8;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
  _menu = { el: menu, anchor };
  setTimeout(() => {
    document.addEventListener('pointerdown', _menuDocDown, true);
    addEventListener('keydown', _menuKey);
    addEventListener('scroll', _menuScroll, true);
  }, 0);
}
export function closeMenu() {
  const layer = document.getElementById('menuLayer');
  if (layer) layer.innerHTML = '';
  layer.classList.add('hidden');
  _menu = null;
  document.removeEventListener('pointerdown', _menuDocDown, true);
  document.removeEventListener('keydown', _menuKey);
  document.removeEventListener('scroll', _menuScroll, true);
}

/* ============ Modal helpers ============ */
export function openModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.remove('hidden'); }
}
export function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('hidden');
}
export function closeAllModals() {
  document.querySelectorAll('.modal-wrap:not(.hidden)').forEach(m => m.classList.add('hidden'));
}
export function bindCloseButtons(root = document) {
  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]');
    if (c) { closeModal(c.dataset.close); return; }
    const wrap = e.target.closest('.modal-wrap');
    if (wrap && e.target === wrap) wrap.classList.add('hidden');
  });
}
