const I18N = {
  hi: {
    kicker: "Same dikhe. Editable rahe.",
    heroTitle: "Document ki photo ya PDF ko MS Word mein utaar do.",
    lede: "Screenshot, scanned page ya PDF upload karo. Kagaz usko editable Word file banata hai — layout ke saath — aur pages ko image mein bhi nikal deta hai. Download turant.",
    dropTitle: "File yahan chhod do",
    dropHint: "ya click karke photo / screenshot / PDF choose karo · max 28 MB",
    browse: "File choose karo",
    howTitle: "Teen kadam",
    step1: "1. Document ki photo, screenshot ya PDF daalo.",
    step2: "2. Text nikal kar Word jaisa layout banate hain.",
    step3: "3. Editable Word, visual copy, aur PNG pages download.",
    fine: "Digital PDF ka asli text rehta hai (Hindi/English). Scanned photo par OCR chalta hai.",
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
    n2p: "Agar PDF mein pehle se text hai to wahi nikalte hain — Hindi headings, tables, numbers sab. Scanned photo ya screenshot ho to OCR se padhte hain.",
    n3t: "Kitna same?",
    n3p: "Tables, headings, alignment aur spacing recreate hote hain. Complicated design (watermarks, odd columns) ke liye visual Word + PNG use karo.",
  },
  en: {
    kicker: "Looks the same. Stays editable.",
    heroTitle: "Turn a document photo or PDF into Microsoft Word.",
    lede: "Drop a screenshot, scanned page, or PDF. Kagaz rebuilds an editable Word file that follows the layout, and also exports every page as an image. Download instantly.",
    dropTitle: "Drop your file here",
    dropHint: "or click to choose a photo / screenshot / PDF · max 28 MB",
    browse: "Choose a file",
    howTitle: "Three steps",
    step1: "1. Add a document photo, screenshot, or PDF.",
    step2: "2. We extract the text and rebuild a Word-like layout.",
    step3: "3. Download editable Word, a visual copy, and PNG pages.",
    fine: "Born-digital PDFs keep real text (Hindi/English). Photos and scans go through OCR.",
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
    n2p: "If the PDF already has text, we keep it — Hindi headings, tables, numbers. Scanned photos and screenshots are read with OCR.",
    n3t: "How close is it?",
    n3p: "Tables, headings, alignment, and spacing are rebuilt. For busy designs, use the visual Word file and the PNGs.",
  },
};

let lang = "hi";
let jobId = null;
let result = null;
let pageIndex = 1;

const $ = (id) => document.getElementById(id);
const drop = $("drop");
const fileInput = $("file");

function applyLang() {
  const pack = I18N[lang];
  document.documentElement.lang = lang === "hi" ? "hi" : "en";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (pack[key]) el.textContent = pack[key];
  });
  $("langBtn").textContent = lang === "hi" ? "EN" : "हिं";
}

$("langBtn").addEventListener("click", () => {
  lang = lang === "hi" ? "en" : "hi";
  applyLang();
});

function show(id) {
  $(id).classList.remove("hidden");
}
function hide(id) {
  $(id).classList.add("hidden");
}

function setProgress(pct, msg) {
  $("barFill").style.width = `${pct}%`;
  $("progressPct").textContent = `${pct}%`;
  $("statusMsg").textContent = msg || "";
  document.querySelector(".bar").setAttribute("aria-valuenow", String(pct));
}

function resetUi() {
  jobId = null;
  result = null;
  pageIndex = 1;
  fileInput.value = "";
  hide("work");
  hide("result");
  show("stage");
}

$("againBtn").addEventListener("click", resetUi);

function openPicker() {
  fileInput.click();
}

$("browseBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  openPicker();
});
drop.addEventListener("click", openPicker);
drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openPicker();
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
  if (f) startUpload(f);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) startUpload(fileInput.files[0]);
});

async function startUpload(file) {
  hide("stage");
  hide("result");
  show("work");
  $("fileName").textContent = file.name;
  setProgress(4, lang === "hi" ? "Upload ho rahi hai…" : "Uploading…");

  const body = new FormData();
  body.append("file", file);
  let data;
  try {
    const res = await fetch("/api/convert", { method: "POST", body });
    data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
  } catch (err) {
    setProgress(0, err.message || "Upload fail");
    return;
  }
  jobId = data.job_id;
  poll();
}

async function poll() {
  if (!jobId) return;
  try {
    const res = await fetch(`/api/status/${jobId}`);
    const data = await res.json();
    setProgress(data.progress || 0, data.message || "");
    if (data.status === "done") {
      result = data.result;
      renderResult();
      return;
    }
    if (data.status === "error") {
      setProgress(0, data.message || "Error");
      return;
    }
  } catch (err) {
    setProgress(0, lang === "hi" ? "Server se baat nahi ho paayi." : "Could not reach the server.");
    return;
  }
  setTimeout(poll, 700);
}

function renderResult() {
  hide("work");
  show("result");
  const pages = result.pages || 1;
  $("resultTitle").textContent =
    lang === "hi"
      ? `${pages} page · Word + images ready`
      : `${pages} page${pages > 1 ? "s" : ""} · Word + images ready`;
  $("dlWord").href = `/api/download/${jobId}/word`;
  $("dlVisual").href = `/api/download/${jobId}/visual`;
  $("dlZip").href = `/api/download/${jobId}/images`;
  pageIndex = 1;
  paintPage();
}

function paintPage() {
  const pages = (result && result.preview) || [];
  const total = pages.length || result.pages || 1;
  const info = pages[pageIndex - 1] || {};
  $("pageLabel").textContent = `${pageIndex} / ${total}`;
  $("pageImg").src = `/api/page/${jobId}/${pageIndex}.png?t=${Date.now()}`;
  $("pageText").textContent = info.text || (lang === "hi" ? "(is page par text nahi mila)" : "(no text found on this page)");
  const src = info.source === "pdf-text" ? "PDF TEXT" : "OCR";
  $("sourceBadge").textContent = src;
  $("dlPage").href = `/api/page/${jobId}/${pageIndex}.png`;
  $("dlPage").setAttribute("download", `page-${String(pageIndex).padStart(2, "0")}.png`);
  $("prevPage").disabled = pageIndex <= 1;
  $("nextPage").disabled = pageIndex >= total;
}

$("prevPage").addEventListener("click", () => {
  if (pageIndex > 1) {
    pageIndex -= 1;
    paintPage();
  }
});
$("nextPage").addEventListener("click", () => {
  const total = (result && result.preview && result.preview.length) || 1;
  if (pageIndex < total) {
    pageIndex += 1;
    paintPage();
  }
});

applyLang();
