/* Kagaz Studio — runs entirely in the browser */
const I18N = {
  hi: {
    kicker: "Phone pe chalo. Computer nahi chahiye.",
    heroTitle: "Document ki photo ya PDF ko MS Word mein utaar do.",
    lede: "Screenshot, scanned page ya PDF yahin choose karo. File aapke phone mein hi convert hoti hai — editable Word, visual copy, aur PNG images. Download turant.",
    dropTitle: "File yahan chhod do",
    dropHint: "ya tap karke photo / screenshot / PDF choose karo · max 20 MB",
    browse: "File choose karo",
    howTitle: "Teen kadam",
    step1: "1. Document ki photo, screenshot ya PDF daalo.",
    step2: "2. Text nikal kar Word jaisa layout banate hain.",
    step3: "3. Editable Word, visual copy, aur PNG pages download.",
    fine: "Sab kuch aapke browser mein hota hai. File kahin server pe nahi jaati.",
    ready: "Taiyaar",
    again: "Nayi file",
    dlWord: "Editable Word",
    dlWordSub: "Text select / edit ho sakta hai",
    dlVisual: "Visual Word",
    dlVisualSub: "Page bilkul photo jaisi",
    dlZip: "Saari images (ZIP)",
    dlZipSub: "Har page PNG mein",
    previewTitle: "Original pages",
    textTitle: "Nikala hua text",
    dlPage: "Is page ko PNG download karo",
    n1t: "Do Word files kyun?",
    n1p: "Editable wali mein text type ki tarah rehta hai — copy, edit, search. Visual wali mein original page ki photo Word ke andar baithti hai, isliye dikhawat same-to-same hoti hai.",
    n2t: "Kab OCR, kab asli text?",
    n2p: "Agar PDF mein pehle se text hai to wahi nikalte hain — Hindi headings aur numbers bhi. Scanned photo ya screenshot ho to OCR se padhte hain.",
    n3t: "Computer nahi hai?",
    n3p: "Koi baat nahi. Ye site phone ke Chrome / Safari mein khul ke kaam karti hai. Convert ke baad Word file Downloads mein save ho jaati hai.",
  },
  en: {
    kicker: "Works on your phone. No computer needed.",
    heroTitle: "Turn a document photo or PDF into Microsoft Word.",
    lede: "Pick a screenshot, scanned page, or PDF. Conversion happens on your device — editable Word, a lookalike copy, and PNG pages. Download instantly.",
    dropTitle: "Drop your file here",
    dropHint: "or tap to choose a photo / screenshot / PDF · max 20 MB",
    browse: "Choose a file",
    howTitle: "Three steps",
    step1: "1. Add a document photo, screenshot, or PDF.",
    step2: "2. We extract the text and rebuild a Word-like layout.",
    step3: "3. Download editable Word, a visual copy, and PNG pages.",
    fine: "Everything runs in your browser. The file never goes to a server.",
    ready: "Ready",
    again: "New file",
    dlWord: "Editable Word",
    dlWordSub: "Text you can select and edit",
    dlVisual: "Visual Word",
    dlVisualSub: "Pages look exactly like the photo",
    dlZip: "All images (ZIP)",
    dlZipSub: "Every page as PNG",
    previewTitle: "Original pages",
    textTitle: "Extracted text",
    dlPage: "Download this page as PNG",
    n1t: "Why two Word files?",
    n1p: "The editable file is real typed text — copy, edit, search. The visual file places the original page image inside Word, so it looks identical.",
    n2t: "OCR or real text?",
    n2p: "If the PDF already has text, we keep it — including Hindi. Photos and scans are read with OCR.",
    n3t: "No computer?",
    n3p: "Open this site on your phone. After conversion the Word file lands in Downloads.",
  },
};

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 20;
const MAX_SIDE = 1800;
const TWIP = 1440;

let lang = "hi";
let pageIndex = 1;
let pages = [];
let downloads = { word: null, visual: null, zip: null };
let ocrWorker = null;
let ocrReady = false;

const $ = (id) => document.getElementById(id);

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

function applyLang() {
  const pack = I18N[lang];
  document.documentElement.lang = lang === "hi" ? "hi" : "en";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (pack[key]) el.textContent = pack[key];
  });
  $("langBtn").textContent = lang === "hi" ? "EN" : "हिं";
}

function show(id) {
  $(id).classList.remove("hidden");
}
function hide(id) {
  $(id).classList.add("hidden");
}

function setProgress(pct, msg) {
  const n = Math.max(0, Math.min(100, Math.round(pct)));
  $("barFill").style.width = `${n}%`;
  $("progressPct").textContent = `${n}%`;
  $("statusMsg").textContent = msg || "";
  document.querySelector(".bar").setAttribute("aria-valuenow", String(n));
}

function revokeDownloads() {
  Object.values(downloads).forEach((url) => {
    if (url) URL.revokeObjectURL(url);
  });
  downloads = { word: null, visual: null, zip: null };
  pages.forEach((p) => {
    if (p.url) URL.revokeObjectURL(p.url);
  });
  pages = [];
}

function resetUi() {
  revokeDownloads();
  pageIndex = 1;
  $("file").value = "";
  hide("work");
  hide("result");
  show("stage");
}

function joinWords(words) {
  const parts = [];
  words.forEach((w) => {
    const t = String(w.text || "").trim();
    if (!t) return;
    if (!parts.length) {
      parts.push(t);
      return;
    }
    const prev = parts[parts.length - 1];
    if (",.;:!?%)]}'\"”’".includes(t[0])) parts[parts.length - 1] = prev + t;
    else if ("([{\"'“‘/-".includes(prev.slice(-1))) parts[parts.length - 1] = prev + t;
    else parts.push(t);
  });
  return parts.join(" ");
}

function groupLines(boxes) {
  if (!boxes.length) return [];
  const items = boxes.slice().sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
  const clusters = [];
  items.forEach((box) => {
    const cy = (box.y0 + box.y1) / 2;
    const h = Math.max(box.y1 - box.y0, 1);
    const last = clusters[clusters.length - 1];
    if (last) {
      const lcy = last.reduce((s, b) => s + (b.y0 + b.y1) / 2, 0) / last.length;
      const lh = last.reduce((s, b) => s + (b.y1 - b.y0), 0) / last.length;
      if (Math.abs(cy - lcy) <= Math.max(h, lh) * 0.55) {
        last.push(box);
        return;
      }
    }
    clusters.push([box]);
  });
  return clusters.map((cluster) => {
    cluster.sort((a, b) => a.x0 - b.x0);
    const x0 = Math.min(...cluster.map((b) => b.x0));
    const y0 = Math.min(...cluster.map((b) => b.y0));
    const x1 = Math.max(...cluster.map((b) => b.x1));
    const y1 = Math.max(...cluster.map((b) => b.y1));
    const size = Math.max(...cluster.map((b) => b.size || 12));
    return { boxes: cluster, text: joinWords(cluster), x0, y0, x1, y1, size };
  });
}

function guessAlign(line, pageW) {
  const left = line.x0;
  const right = pageW - line.x1;
  const width = line.x1 - line.x0;
  if (width < pageW * 0.72) {
    if (Math.abs(left - right) < pageW * 0.12 && left > pageW * 0.18) return "center";
    if (right < pageW * 0.08 && left > pageW * 0.22) return "right";
  }
  return "left";
}

function isHeading(text, size, median) {
  const t = (text || "").trim();
  if (!t || t.length > 80) return size > median * 1.3;
  const letters = t.replace(/[^A-Za-z\u0900-\u097F]/g, "");
  if (letters.length > 3 && letters === letters.toUpperCase() && /[A-Z]/.test(letters)) return true;
  return size > median * 1.28;
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image khul nahi payi"));
    img.src = src;
  });
}

async function fileToCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function ensureOcr(onLog) {
  if (ocrReady && ocrWorker) return ocrWorker;
  if (!window.Tesseract) throw new Error("OCR library load nahi hui. Internet on karke refresh karo.");
  onLog && onLog(lang === "hi" ? "OCR taiyaar ho raha hai (pehli baar thoda time)…" : "Preparing OCR…");
  try {
    ocrWorker = await Tesseract.createWorker("eng+hin", 1, {
      logger: (m) => {
        if (!onLog) return;
        if (m.status === "loading language traineddata") onLog(lang === "hi" ? "Hindi + English padhne ka model aa raha hai…" : "Loading Hindi + English OCR…");
        if (m.status === "initializing api") onLog(lang === "hi" ? "OCR start ho raha hai…" : "Starting OCR…");
      },
    });
  } catch (err) {
    ocrWorker = await Tesseract.createWorker("eng", 1, { logger: () => {} });
  }
  ocrReady = true;
  return ocrWorker;
}

async function ocrCanvas(canvas, onProgress) {
  const worker = await ensureOcr();
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  const boxes = [];
  const words = data.words || [];
  words.forEach((w) => {
    const text = (w.text || "").trim();
    if (!text) return;
    if (typeof w.confidence === "number" && w.confidence < 35) return;
    const b = w.bbox || {};
    const x0 = b.x0 ?? 0;
    const y0 = b.y0 ?? 0;
    const x1 = b.x1 ?? x0 + 10;
    const y1 = b.y1 ?? y0 + 12;
    boxes.push({
      text,
      x0,
      y0,
      x1,
      y1,
      size: Math.max(8, (y1 - y0) * 0.75),
    });
  });
  return { text: (data.text || "").trim(), boxes };
}

async function renderPdfPage(pdf, index, scale) {
  const page = await pdf.getPage(index);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const content = await page.getTextContent();
  const boxes = [];
  (content.items || []).forEach((item) => {
    const text = (item.str || "").trim();
    if (!text) return;
    const t = item.transform || [1, 0, 0, 1, 0, 0];
    const x = t[4];
    const y = t[5];
    const h = Math.abs(t[3] || item.height || 12);
    const w = item.width || text.length * h * 0.5;
    const yTop = viewport.height - y - h;
    boxes.push({
      text,
      x0: x,
      y0: yTop,
      x1: x + w,
      y1: yTop + h,
      size: Math.max(8, h * 0.9),
    });
  });
  const raw = boxes.map((b) => b.text).join(" ");
  return { canvas, boxes, raw, viewport };
}

function fitPageTwips(pxW, pxH) {
  const ratio = pxW / pxH;
  if (ratio > 0.65 && ratio < 0.78) return { width: 11906, height: 16838 };
  if (ratio > 1.28 && ratio < 1.55) return { width: 16838, height: 11906 };
  const dpi = 144;
  let wIn = pxW / dpi;
  let hIn = pxH / dpi;
  const max = 21;
  if (wIn > max || hIn > max) {
    const s = Math.min(max / wIn, max / hIn);
    wIn *= s;
    hIn *= s;
  }
  wIn = Math.max(wIn, 4);
  hIn = Math.max(hIn, 4);
  return { width: Math.round(wIn * TWIP), height: Math.round(hIn * TWIP) };
}

function buildEditableDoc(pageList) {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType } = docx;
  const sections = pageList.map((page) => {
    const size = fitPageTwips(page.width, page.height);
    const lines = page.lines || [];
    const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)] || 12;
    const children = [];
    if (!lines.length) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: lang === "hi" ? "Is page se readable text nahi mila. Visual Word use karo." : "No readable text on this page. Use the visual Word file.",
              italics: true,
              size: 22,
              color: "5A503C",
            }),
          ],
        })
      );
    } else {
      let prevY1 = 0;
      lines.forEach((line, idx) => {
        const gap = idx === 0 ? 0 : Math.max(0, line.y0 - prevY1);
        prevY1 = line.y1;
        const spaceBefore = Math.min(400, Math.round((gap / page.height) * 800));
        const heading = isHeading(line.text, line.size, median);
        const fontPt = Math.max(16, Math.min(52, Math.round(line.size * 1.6)));
        const align =
          line.align === "center" ? AlignmentType.CENTER : line.align === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT;
        const leftTw = line.align === "left" ? Math.round((line.x0 / page.width) * size.width * 0.55) : 0;
        children.push(
          new Paragraph({
            alignment: align,
            spacing: { before: spaceBefore, after: 40 },
            indent: leftTw > 120 ? { left: Math.min(leftTw, 2400) } : undefined,
            children: [
              new TextRun({
                text: line.text,
                bold: heading,
                size: fontPt,
                font: /[\u0900-\u097F]/.test(line.text) ? "Nirmala UI" : "Calibri",
              }),
            ],
          })
        );
      });
    }
    return {
      properties: {
        page: {
          size,
          margin: { top: 640, bottom: 720, left: 640, right: 640 },
        },
      },
      children,
    };
  });
  const document = new Document({
    creator: "Kagaz Studio",
    title: "Kagaz editable document",
    sections,
  });
  return Packer.toBlob(document);
}

async function buildVisualDoc(pageList) {
  const { Document, Packer, Paragraph, ImageRun } = docx;
  const sections = [];
  for (const page of pageList) {
    const size = fitPageTwips(page.width, page.height);
    const buf = await page.blob.arrayBuffer();
    const widthPx = Math.round((size.width / TWIP) * 96);
    const heightPx = Math.round((size.height / TWIP) * 96);
    sections.push({
      properties: {
        page: {
          size,
          margin: { top: 0, bottom: 0, left: 0, right: 0 },
        },
      },
      children: [
        new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [
            new ImageRun({
              data: buf,
              transformation: { width: widthPx, height: heightPx },
              type: "png",
            }),
          ],
        }),
      ],
    });
  }
  const document = new Document({
    creator: "Kagaz Studio",
    title: "Kagaz visual copy",
    sections,
  });
  return Packer.toBlob(document);
}

async function buildZip(pageList) {
  const zip = new JSZip();
  pageList.forEach((page, i) => {
    zip.file(`page-${String(i + 1).padStart(2, "0")}.png`, page.blob);
  });
  return zip.generateAsync({ type: "blob" });
}

function finalizePage(width, height, boxes, source, blob, url) {
  const lines = groupLines(boxes).filter((l) => l.text);
  lines.forEach((l) => {
    l.align = guessAlign(l, width);
  });
  const text = lines.map((l) => l.text).join("\n");
  return { width, height, lines, source, blob, url, text };
}

async function convertImage(file, onProgress) {
  onProgress(8, lang === "hi" ? "Photo padh rahe hain…" : "Reading photo…");
  const canvas = await fileToCanvas(file);
  onProgress(18, lang === "hi" ? "OCR start…" : "Starting OCR…");
  const { boxes, text } = await ocrCanvas(canvas, onProgress);
  onProgress(78, lang === "hi" ? "Page image bana rahe hain…" : "Building page image…");
  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);
  const used = boxes.length ? boxes : [];
  const page = finalizePage(canvas.width, canvas.height, used, "ocr", blob, url);
  if (!page.text && text) page.text = text;
  return [page];
}

async function convertPdf(file, onProgress) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const n = Math.min(pdf.numPages, MAX_PAGES);
  const out = [];
  for (let i = 1; i <= n; i += 1) {
    const base = 8 + ((i - 1) / n) * 70;
    onProgress(base, lang === "hi" ? `Page ${i}/${n} padh rahe hain…` : `Reading page ${i}/${n}…`);
    const rendered = await renderPdfPage(pdf, i, 1.6);
    let boxes = rendered.boxes;
    let source = "pdf-text";
    const rawLen = (rendered.raw || "").replace(/\s+/g, "").length;
    if (rawLen < 25) {
      onProgress(base + 8, lang === "hi" ? `Page ${i} OCR…` : `OCR page ${i}…`);
      const ocr = await ocrCanvas(rendered.canvas);
      boxes = ocr.boxes;
      source = "ocr";
    }
    const blob = await canvasToBlob(rendered.canvas);
    const url = URL.createObjectURL(blob);
    out.push(finalizePage(rendered.canvas.width, rendered.canvas.height, boxes, source, blob, url));
  }
  return out;
}

async function convertFile(file) {
  if (file.size > MAX_BYTES) {
    throw new Error(lang === "hi" ? "File 20 MB se chhoti honi chahiye." : "File must be under 20 MB.");
  }
  const name = (file.name || "document").toLowerCase();
  const type = file.type || "";
  const isPdf = type === "application/pdf" || name.endsWith(".pdf");
  const isImage = type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(name);
  if (!isPdf && !isImage) {
    throw new Error(lang === "hi" ? "Sirf PDF, PNG, JPG ya WEBP chalegi." : "Only PDF, PNG, JPG or WEBP.");
  }
  if (isPdf) return convertPdf(file, setProgress);
  return convertImage(file, setProgress);
}

function paintPage() {
  const total = pages.length || 1;
  const info = pages[pageIndex - 1] || {};
  $("pageLabel").textContent = `${pageIndex} / ${total}`;
  $("pageImg").src = info.url || "";
  $("pageText").textContent =
    info.text || (lang === "hi" ? "(is page par text nahi mila)" : "(no text found on this page)");
  $("sourceBadge").textContent = info.source === "pdf-text" ? "PDF TEXT" : "OCR";
  $("dlPage").href = info.url || "#";
  $("dlPage").setAttribute("download", `page-${String(pageIndex).padStart(2, "0")}.png`);
  $("prevPage").disabled = pageIndex <= 1;
  $("nextPage").disabled = pageIndex >= total;
}

function bindDownload(el, url, filename) {
  el.href = url;
  el.setAttribute("download", filename);
}

async function startConvert(file) {
  hide("stage");
  hide("result");
  show("work");
  $("fileName").textContent = file.name;
  setProgress(3, lang === "hi" ? "Shuru ho raha hai…" : "Starting…");
  try {
    const converted = await convertFile(file);
    if (!converted.length) throw new Error(lang === "hi" ? "Koi page nahi mila." : "No pages found.");
    setProgress(84, lang === "hi" ? "Word file bana rahe hain…" : "Building Word file…");
    const wordBlob = await buildEditableDoc(converted);
    setProgress(91, lang === "hi" ? "Visual Word bana rahe hain…" : "Building visual Word…");
    const visualBlob = await buildVisualDoc(converted);
    setProgress(96, lang === "hi" ? "Images ZIP…" : "Zipping images…");
    const zipBlob = await buildZip(converted);
    pages = converted;
    const stem = (file.name || "document").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") || "document";
    downloads.word = URL.createObjectURL(wordBlob);
    downloads.visual = URL.createObjectURL(visualBlob);
    downloads.zip = URL.createObjectURL(zipBlob);
    bindDownload($("dlWord"), downloads.word, `${stem}-editable.docx`);
    bindDownload($("dlVisual"), downloads.visual, `${stem}-visual.docx`);
    bindDownload($("dlZip"), downloads.zip, `${stem}-pages.zip`);
    hide("work");
    show("result");
    $("resultTitle").textContent =
      lang === "hi"
        ? `${pages.length} page · Word + images ready`
        : `${pages.length} page${pages.length > 1 ? "s" : ""} · Word + images ready`;
    pageIndex = 1;
    paintPage();
    setProgress(100, "Ready");
  } catch (err) {
    console.error(err);
    setProgress(0, err.message || (lang === "hi" ? "Conversion fail ho gayi." : "Conversion failed."));
  }
}

const drop = $("drop");
const fileInput = $("file");

$("langBtn").addEventListener("click", () => {
  lang = lang === "hi" ? "en" : "hi";
  applyLang();
});
$("againBtn").addEventListener("click", resetUi);
$("browseBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});
drop.addEventListener("click", () => fileInput.click());
drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
["dragenter", "dragover"].forEach((ev) => {
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
});
["dragleave", "drop"].forEach((ev) => {
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove("over");
  });
});
drop.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) startConvert(f);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) startConvert(fileInput.files[0]);
});
$("prevPage").addEventListener("click", () => {
  if (pageIndex > 1) {
    pageIndex -= 1;
    paintPage();
  }
});
$("nextPage").addEventListener("click", () => {
  if (pageIndex < pages.length) {
    pageIndex += 1;
    paintPage();
  }
});

applyLang();
