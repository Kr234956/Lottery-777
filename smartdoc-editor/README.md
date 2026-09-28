# SmartDoc Editor

**Professional Office Document Editor web app** — PDF, screenshot, PNG/JPG aur scanned documents ke andar likhe text ko read karke (OCR) editable banayein, modify karein, erase karein, images/drawings add karein, aur wapas PDF / PNG / JPG / ZIP me export karein.

> 🔒 **100% client-side** — saari processing aapke browser me hoti hai. Files kahin upload nahi hoti, koi public URL nahi banta, aur bina permission ke koi file store/share nahi hoti.

## Run karna (development)

```bash
cd smartdoc-editor
python3 -m http.server 8080
# browser me kholo: http://localhost:8080
```

Koi build step nahi — plain HTML/CSS/JS (ES modules). Libraries CDN se load hoti hain (internet chahiye):

| Library | Kaam |
|---|---|
| [Tesseract.js](https://tesseract.projectnaptha.com/) | OCR — Hindi + English + Hinglish (`hin+eng`), numbers, special characters |
| [pdf.js](https://mozilla.github.io/pdf.js/) | PDF rendering, page extraction, searchable-PDF text layer |
| [jsPDF](https://github.com/parallax/jsPDF) | PDF export (flattened + editable text) |
| [JSZip](https://stuk.github.io/jszip/) | Multi-page image ZIP export |

## Features

- **Upload**: file manager (PDF), gallery (PNG/JPG/JPEG/WEBP/SVG), screenshot, drag & drop, multiple files, camera scan (`capture`), multi-page PDF (max 30 pages, 50MB/file)
- **Auto file-type detect**: Searchable PDF / Scanned PDF / Image / Screenshot — badge properties panel me
- **OCR**: word-level bounding boxes → positioned editable text blocks; paragraph/heading/list heuristics; low-confidence text par orange dashed border (manual correction); re-OCR per page; progress % ke saath
- **Editable canvas**: original page background/reference + text layers (click → select, double-click → edit, type over) + image layers + ink canvas — alag-alag manage hote hain
- **Formatting toolbar (Word-style)**: Bold, Italic, Underline, Strikethrough, font family, size, A+/A−, color, highlight, box background, align (L/C/R/Justify), line spacing, letter spacing, UPPER/lower, superscript, subscript, bulleted/numbered list, undo/redo
- **Eraser tools**: Smart Eraser (selected text → remove + auto background-match fill), White/Background brush (size control, page ke background color auto-detect — white/cream/grey/colored), Rectangle clean selection, Lasso (freehand) clean selection; brush/rect/lasso se paint hone par us area ka text bhi remove + background fill; undo/redo
- **Add Text**: click-to-create text box; resize, move, rotate, font/size/color/alignment, transparent/colored background, border, box shadow, text shadow, "Match original document font"
- **Image/Logo insert**: PNG/JPG/JPEG/WEBP/SVG; transparent PNG preserve; resize (aspect lock), move, rotate, crop (free/1:1/16:9/4:3/circle), opacity, border, shadow, flip H/V, replace, delete, bring to front / send to back
- **Page management**: add blank (A4/Letter/Legal/custom mm), delete, duplicate, rotate 90°, reorder (thumbnail drag + up/down), zoom in/out, fit-to-screen, thumbnail sidebar, page numbers, landscape/portrait
- **Drawing/annotation**: pen, marker, highlighter, line, arrow, rectangle, circle, signature, freehand; color picker, stroke width, opacity
- **Export**: PDF flattened (pixel-perfect), PDF editable (selectable text — Latin text; Devanagari par auto-fallback flattened), PNG, JPG, har page separate image + ZIP, original (2×) / compressed quality, custom file name, `save project` (JSON) + `open project`
  - Default export format uploaded file ke type ke hisaab se (PDF→PDF, PNG→PNG, JPG→JPG)
  - Export se pehle Preview mode; original file kabhi overwrite nahi hoti (`-edited` naam)
- **Share**: Download, native share sheet (`navigator.share` with file), WhatsApp (file share ya fallback: download + wa.me link), Copy link (small files ka data-URL; privacy ke liye koi public host nahi), Email (mailto), Save to device
- **Office UI**: white/light-grey theme, blue accent, left thumbnails, center canvas, right properties panel, top toolbar, mobile bottom toolbar, tooltips, keyboard shortcuts
- **Privacy/UX**: file size limits visible, unsupported file error, progress bars (upload/OCR/export), auto-save draft (localStorage) + restore card, unsaved-changes refresh warning, large-PDF lazy page rendering, pinch-to-zoom + two-finger pan (touch), Ctrl+wheel zoom, keyboard navigation, readable contrast

## Keyboard shortcuts

`Ctrl+Z/Y` undo/redo • `Ctrl+B/I/U` bold/italic/underline • `Ctrl+C/X/V/D` copy/cut/paste/duplicate • `Del` delete • arrows nudge (Shift=10px) • `Ctrl+S` save project • `Ctrl+E` export • `V` select • `T` text • `E` eraser • `P` pen • `F`/`0` fit • `+/−` zoom • `Space`/middle-drag pan • `Esc` deselect

## Architecture

```
index.html          — app shell, landing, modals, overlays
css/app.css         — office-style theme, responsive (desktop/tablet/mobile)
js/ui.js            — icons, toasts, menus, modals, helpers
js/importer.js      — pdf.js (render + text extraction), image import, font guessing
js/ocr.js           — Tesseract.js worker management, OCR → positioned text spans
js/exporter.js      — canvas compositing (foreignObject text raster), PDF/PNG/JPG/ZIP
js/share.js         — download / navigator.share / WhatsApp / email / copy-link
js/app.js           — state, history (undo/redo), drafts, page rendering, selection &
                      gizmo, gestures (move/resize/rotate/ink/erase/pinch/pan),
                      text editing, formatting, properties panel, export dialog
```

**State model**: `state.pages[]` — har page me `spans[]` (text), `images[]`, `fills[]` (eraser fills), `ink[]` (drawings), page size (px + pt). Background images `bgStore` me alag. History = page-state snapshots (bg dataURLs exclude kiye hain, memory save).

## Known limitations

- OCR accuracy Tesseract par dependent hai (scanned quality ke hisaab se); tables ka structure detect nahi hota, lekin table ka text position ke saath readable/editable hota hai
- Editable PDF me Devanagari (Hindi) text standard PDF fonts me nahi likha ja sakta — app automatically flattened PDF export karke warn karta hai
- "Copy link" public URL nahi banta (privacy) — chhoti files ke liye data-URL copy hota hai, warna file download + share sheet suggest hoti hai
- PDF ke original fonts exact nahi match hote (closest web font estimate hota hai)
