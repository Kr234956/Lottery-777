"""Kagaz Studio — screenshot / photo / PDF → editable Word + images."""

from __future__ import annotations

import json
import re
import threading
import time
import uuid
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request, send_file, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix

from converter import IMAGE_EXTS, PDF_EXTS, ConversionError, convert_file, warmup

ROOT = Path(__file__).resolve().parent
UPLOADS = ROOT / "uploads"
JOBS = ROOT / "jobs"
ALLOWED = IMAGE_EXTS | PDF_EXTS
MAX_BYTES = 28 * 1024 * 1024

UPLOADS.mkdir(exist_ok=True)
JOBS.mkdir(exist_ok=True)

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["MAX_CONTENT_LENGTH"] = MAX_BYTES
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

_lock = threading.Lock()
_state: dict[str, dict] = {}


def job_dir(job_id: str) -> Path:
    return JOBS / job_id


def set_state(job_id: str, **kwargs) -> None:
    with _lock:
        cur = _state.setdefault(job_id, {"status": "queued", "progress": 0, "message": ""})
        cur.update(kwargs)
        (job_dir(job_id) / "status.json").write_text(json.dumps(cur, ensure_ascii=False), encoding="utf-8")


def get_state(job_id: str) -> dict | None:
    with _lock:
        if job_id in _state:
            return dict(_state[job_id])
    status_file = job_dir(job_id) / "status.json"
    if status_file.exists():
        try:
            return json.loads(status_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return None
    return None


def safe_job(job_id: str) -> str:
    if not re.fullmatch(r"[a-f0-9-]{36}", job_id):
        abort(404)
    return job_id


def run_job(job_id: str, src: Path) -> None:
    work = job_dir(job_id)
    try:
        set_state(job_id, status="processing", progress=4, message="File taiyaar ho rahi hai…")

        def progress_cb(pct: int, message: str) -> None:
            set_state(job_id, status="processing", progress=int(pct), message=message)

        result = convert_file(src, work, progress_cb=progress_cb)
        (work / "result.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        set_state(
            job_id,
            status="done",
            progress=100,
            message="Ho gaya",
            result=result,
        )
    except ConversionError as exc:
        set_state(job_id, status="error", progress=0, message=str(exc))
    except Exception:
        set_state(
            job_id,
            status="error",
            progress=0,
            message="Conversion fail ho gayi. Dusri file try karein.",
        )


@app.get("/")
def home():
    return send_from_directory(ROOT / "docs", "index.html")


@app.get("/css/<path:filename>")
def docs_css(filename: str):
    return send_from_directory(ROOT / "docs" / "css", filename)


@app.get("/js/<path:filename>")
def docs_js(filename: str):
    return send_from_directory(ROOT / "docs" / "js", filename)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/api/convert")
def api_convert():
    if "file" not in request.files:
        return jsonify({"error": "Koi file nahi mili."}), 400
    fh = request.files["file"]
    if not fh or not fh.filename:
        return jsonify({"error": "File choose karein."}), 400
    name = Path(fh.filename).name
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED:
        return jsonify({"error": "Sirf PDF, PNG, JPG, WEBP, BMP ya TIFF upload karein."}), 400

    job_id = str(uuid.uuid4())
    work = job_dir(job_id)
    work.mkdir(parents=True, exist_ok=True)
    src = work / f"source{ext}"
    fh.save(src)
    if src.stat().st_size == 0:
        return jsonify({"error": "File khali hai."}), 400
    if src.stat().st_size > MAX_BYTES:
        return jsonify({"error": "File 28 MB se chhoti honi chahiye."}), 400

    set_state(job_id, status="queued", progress=1, message="Queue mein…", filename=name)
    thread = threading.Thread(target=run_job, args=(job_id, src), daemon=True)
    thread.start()
    return jsonify({"job_id": job_id})


@app.get("/api/status/<job_id>")
def api_status(job_id: str):
    job_id = safe_job(job_id)
    state = get_state(job_id)
    if not state:
        abort(404)
    payload = {
        "status": state.get("status"),
        "progress": state.get("progress", 0),
        "message": state.get("message", ""),
    }
    if state.get("status") == "done" and state.get("result"):
        payload["result"] = state["result"]
    return jsonify(payload)


@app.get("/api/page/<job_id>/<int:index>.png")
def api_page(job_id: str, index: int):
    job_id = safe_job(job_id)
    path = job_dir(job_id) / "pages" / f"page-{index:02d}.png"
    if not path.exists():
        abort(404)
    return send_file(path, mimetype="image/png")


@app.get("/api/download/<job_id>/<kind>")
def api_download(job_id: str, kind: str):
    job_id = safe_job(job_id)
    state = get_state(job_id)
    if not state or state.get("status") != "done":
        abort(404)
    result = state.get("result") or {}
    mapping = {
        "word": result.get("editable"),
        "editable": result.get("editable"),
        "visual": result.get("visual"),
        "images": result.get("images_zip"),
        "zip": result.get("images_zip"),
    }
    filename = mapping.get(kind)
    if not filename:
        abort(404)
    path = job_dir(job_id) / filename
    if not path.exists():
        abort(404)
    mime = {
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".zip": "application/zip",
    }.get(path.suffix, "application/octet-stream")
    return send_file(path, as_attachment=True, download_name=filename, mimetype=mime)


@app.get("/static/<path:filename>")
def static_files(filename: str):
    return send_from_directory(app.static_folder, filename)


def _warmup_async() -> None:
    try:
        warmup()
    except Exception:
        pass


if __name__ == "__main__":
    threading.Thread(target=_warmup_async, daemon=True).start()
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
