/* ============ SmartDoc — sharing: download, native share, WhatsApp, email, copy link ============ */
import { toast } from './ui.js';

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast('File save ho gayi: ' + name, 'success', 2600);
  return true;
}

/* Native Web Share with the actual file. Returns true if the share sheet was handled. */
export async function shareFile(blob, name, text) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name, text });
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return true; // user closed the sheet
      // fall through to fallback
    }
  }
  return false;
}

/* Download first, then open native share sheet if possible (best effort). */
export async function downloadAndShare(blob, name, text) {
  const ok = await shareFile(blob, name, text);
  if (ok) { toast('Share sheet khul gayi — WhatsApp / Telegram / Gmail choose karein', 'success', 3000); return true; }
  downloadBlob(blob, name);
  toast('File download ho gayi — ab WhatsApp/Gallery me attach karke bhejein', 'info', 4500);
  return false;
}

export async function whatsapp(blob, name, text) {
  const msg = text || `📄 ${name} — SmartDoc Editor se edited document`;
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name, text: msg });
      toast('Share sheet khul gayi — WhatsApp select karein', 'success', 3000);
      return true;
    } catch (e) { if (e && e.name === 'AbortError') return true; }
  }
  downloadBlob(blob, name);
  try { window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener'); } catch (e) {}
  toast('File download ho gayi — WhatsApp me chat kholke ye file attach karein', 'info', 5000);
  return false;
}

export async function copyLink(blob, name) {
  try {
    if (blob.size <= 1_500_000) {
      const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      await navigator.clipboard.writeText(dataUrl);
      toast('File link copy ho gaya (data URL) — chhoti files ke liye', 'success', 3200);
      return true;
    }
  } catch (e) { /* fallthrough */ }
  downloadBlob(blob, name);
  toast('Direct public link nahi banta (files aapke device par hi rehti hain) — file download ho gayi, isse kisi bhi app me share karein', 'info', 5500);
  return false;
}

export function emailShare(name, text) {
  const subject = encodeURIComponent('Edited document: ' + name);
  const body = encodeURIComponent((text || 'Yahan aapka edited document hai (SmartDoc Editor se bana hua).') + '\n\n— sent via SmartDoc Editor');
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
  toast('Email client khul gaya — file attach karke bhejein', 'info', 3500);
}
