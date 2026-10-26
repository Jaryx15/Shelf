#!/usr/bin/env python3
"""
Shelf — a local media server.

Stores and serves files (video, audio, images, documents), with a music player
(streaming with HTTP Range support) and a Material Design UI.
"""

import argparse
import base64
import hashlib
import io
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import time
from functools import wraps
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_file, send_from_directory, Response

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024 * 1024  # 64 GB uploads

# Authentication
APP_PASSWORD = os.environ.get("SHELF_PASSWORD", "").strip()

LIBRARY = ROOT / "library"
CACHE = ROOT / ".cache" / "thumbs"

CATEGORY_DIRS = ["Videos", "Music", "Images", "Documents"]

VIDEO_EXT = {".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".mpg", ".mpeg", ".ts", ".wmv", ".flv"}
AUDIO_EXT = {".mp3", ".flac", ".wav", ".ogg", ".oga", ".m4a", ".aac", ".opus", ".wma"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".avif", ".heic", ".tiff"}
MANGA_EXT = set()
DOC_EXT = {".pdf", ".txt", ".md", ".markdown", ".html", ".htm", ".csv", ".json", ".log", ".rst", ".yaml", ".yml"}

MIME_OVERRIDES = {
    ".md": "text/markdown", ".markdown": "text/markdown", ".log": "text/plain",
    ".m4a": "audio/mp4", ".mka": "audio/x-matroska",
    ".opus": "audio/ogg", ".webp": "image/webp", ".avif": "image/avif",
    ".mkv": "video/x-matroska", ".ts": "video/mp2t", ".csv": "text/csv",
}


COVERS = ROOT / ".cache" / "covers"


def check_auth():
    if not APP_PASSWORD:
        return True
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:] == APP_PASSWORD
    if auth.startswith("Basic "):
        try:
            decoded = base64.b64decode(auth[6:]).decode("utf-8")
            if ":" in decoded:
                _, pwd = decoded.split(":", 1)
                return pwd == APP_PASSWORD
            return decoded == APP_PASSWORD
        except Exception:
            return False
    # Check cookie or query token
    token = request.cookies.get("shelf_token") or request.args.get("token") or ""
    if token == APP_PASSWORD:
        return True
    return False


def require_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if APP_PASSWORD and not check_auth():
            if request.path.startswith("/api/") or request.path.startswith("/media/"):
                resp = jsonify({"error": "Unauthorized"})
                resp.status_code = 401
                resp.headers["WWW-Authenticate"] = 'Basic realm="Shelf"'
                return resp
            resp = Response(
                "Unauthorized", 401,
                {"WWW-Authenticate": 'Basic realm="Shelf"', "Content-Type": "text/plain"},
            )
            return resp
        return f(*args, **kwargs)
    wrapper.__name__ = f.__name__
    return wrapper


def ensure_library():
    LIBRARY.mkdir(parents=True, exist_ok=True)
    for d in CATEGORY_DIRS:
        (LIBRARY / d).mkdir(exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def natural_key(s: str):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def safe_path(rel: str) -> Path:
    """Resolve a client-supplied relative path inside the library, or abort."""
    rel = (rel or "").replace("\\", "/").strip("/")
    if "\x00" in rel:
        abort(400)
    p = (LIBRARY / rel).resolve() if rel else LIBRARY.resolve()
    try:
        p.relative_to(LIBRARY.resolve())
    except ValueError:
        abort(403)
    return p


def rel_of(p: Path) -> str:
    return p.relative_to(LIBRARY.resolve()).as_posix()


def kind_of(p: Path) -> str:
    ext = p.suffix.lower()
    if ext in VIDEO_EXT:
        return "video"
    if ext in AUDIO_EXT:
        return "audio"
    if ext in IMAGE_EXT:
        return "image"
    if ext in DOC_EXT:
        return "document"
    return "file"


def mime_of(p: Path) -> str:
    ext = p.suffix.lower()
    if ext in MIME_OVERRIDES:
        return MIME_OVERRIDES[ext]
    return mimetypes.guess_type(p.name)[0] or "application/octet-stream"


def sanitize(name: str) -> str:
    name = os.path.basename(name.replace("\\", "/"))
    name = re.sub(r'[\x00-\x1f<>:"|?*]', "", name).strip().strip(".")
    return name or "untitled"


def unique_path(dest: Path, name: str) -> Path:
    """Return dest/name, appending " (n)" if it already exists."""
    target = dest / name
    if not target.exists():
        return target
    stem, suffix = Path(name).stem, Path(name).suffix
    for n in range(1, 10000):
        cand = dest / f"{stem} ({n}){suffix}"
        if not cand.exists():
            return cand
    return dest / f"{stem}-{int(time.time())}{suffix}"


def entry_info(p: Path) -> dict:
    try:
        st = p.stat()
    except OSError:
        return None
    return {
        "name": p.name,
        "path": rel_of(p),
        "kind": "folder" if p.is_dir() else kind_of(p),
        "isDir": p.is_dir(),
        "size": st.st_size,
        "mtime": int(st.st_mtime),
    }


def human_size(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024


def run(cmd, timeout=60):
    try:
        return subprocess.run(cmd, capture_output=True, timeout=timeout)
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None


# ---------------------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------------------

@app.get("/")
@require_auth
def index():
    return send_from_directory(ROOT / "static", "index.html")


@app.get("/static/<path:rel>")
@require_auth
def static_files(rel):
    return send_from_directory(ROOT / "static", rel)


# ---------------------------------------------------------------------------
# Media streaming (with HTTP Range support for seeking)
# ---------------------------------------------------------------------------

@app.get("/media/<path:rel>")
@require_auth
def media(rel):
    p = safe_path(rel)
    if not p.is_file():
        abort(404)
    download = request.args.get("dl") == "1"
    headers = {"Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff"}
    if download:
        headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{p.name}"
    resp = send_file(p, mimetype=mime_of(p), conditional=True, max_age=0)
    resp.headers.update(headers)
    return resp


# ---------------------------------------------------------------------------
# Library API
# ---------------------------------------------------------------------------

@app.get("/api/list")
@require_auth
def api_list():
    rel = request.args.get("path", "")
    p = safe_path(rel)
    if not p.exists():
        abort(404)
    if not p.is_dir():
        abort(400)
    items = []
    for entry in p.iterdir():
        if entry.name.startswith("."):
            continue
        info = entry_info(entry)
        if info:
            items.append(info)
    items.sort(key=lambda i: (not i["isDir"], natural_key(i["name"])))
    parent = rel_of(p.parent) if p != LIBRARY.resolve() else None
    return jsonify({"path": rel, "name": p.name, "parent": parent, "items": items})


@app.get("/api/search")
@require_auth
def api_search():
    q = request.args.get("q", "").strip().lower()
    if not q:
        return jsonify({"items": []})
    items = []
    base = LIBRARY.resolve()
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for fn in filenames:
            if fn.startswith("."):
                continue
            if q in fn.lower():
                info = entry_info(Path(dirpath) / fn)
                if info:
                    items.append(info)
        if len(items) >= 300:
            break
    items.sort(key=lambda i: natural_key(i["name"]))
    return jsonify({"items": items[:200]})


@app.get("/api/stats")
@require_auth
def api_stats():
    kinds = {k: {"count": 0, "size": 0} for k in ("video", "audio", "image", "document", "file", "folder")}
    total_size = 0
    for dirpath, dirnames, filenames in os.walk(LIBRARY):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for fn in filenames:
            if fn.startswith("."):
                continue
            fp = Path(dirpath) / fn
            try:
                sz = fp.stat().st_size
            except OSError:
                continue
            k = kind_of(fp)
            kinds[k]["count"] += 1
            kinds[k]["size"] += sz
            total_size += sz
    return jsonify({"kinds": kinds, "totalSize": total_size})


@app.get("/api/recent")
@require_auth
def api_recent():
    items = []
    for dirpath, dirnames, filenames in os.walk(LIBRARY):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for fn in filenames:
            if fn.startswith("."):
                continue
            info = entry_info(Path(dirpath) / fn)
            if info:
                items.append(info)
    items.sort(key=lambda i: -i["mtime"])
    return jsonify({"items": items[:16]})


@app.post("/api/upload")
@require_auth
def api_upload():
    dest_rel = request.form.get("path", "")
    dest = safe_path(dest_rel)
    if not dest.exists() or not dest.is_dir():
        abort(400)
    files = request.files.getlist("files")
    rels = request.form.getlist("rel")
    saved = []
    for i, fs in enumerate(files):
        if not fs.filename:
            continue
        # Relative path (preserves folder structure from folder/drag-drop uploads)
        sub = rels[i] if i < len(rels) else ""
        sub = "/".join(sanitize(seg) for seg in sub.split("/") if seg and seg.strip())
        target_dir = dest / sub if sub else dest
        target_dir.mkdir(parents=True, exist_ok=True)
        name = sanitize(fs.filename)
        target = unique_path(target_dir, name)
        fs.save(str(target))
        saved.append(rel_of(target))
    return jsonify({"saved": saved})


@app.post("/api/mkdir")
@require_auth
def api_mkdir():
    data = request.get_json(silent=True) or {}
    dest = safe_path(data.get("path", ""))
    name = sanitize(data.get("name", ""))
    if not dest.is_dir():
        abort(400)
    target = dest / name
    if target.exists():
        return jsonify({"error": "Already exists"}), 409
    target.mkdir()
    return jsonify({"path": rel_of(target)})


@app.post("/api/rename")
@require_auth
def api_rename():
    data = request.get_json(silent=True) or {}
    p = safe_path(data.get("path", ""))
    name = sanitize(data.get("name", ""))
    if not p.exists() or p == LIBRARY.resolve():
        abort(404)
    target = unique_path(p.parent, name)
    p.rename(target)
    return jsonify({"path": rel_of(target)})


@app.delete("/api/file")
@require_auth
def api_delete():
    p = safe_path(request.args.get("path", ""))
    if not p.exists() or p == LIBRARY.resolve():
        abort(404)
    if p.is_dir():
        shutil.rmtree(p)
    else:
        p.unlink()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Thumbnails
# ---------------------------------------------------------------------------

def thumb_cache_key(p: Path) -> Path:
    st = p.stat()
    key = hashlib.sha1(f"{p}|{st.st_mtime_ns}|{st.st_size}".encode()).hexdigest()
    return CACHE / f"{key}.jpg"


def make_thumb(p: Path) -> Path | None:
    """Generate a thumbnail, return the cached file or None."""
    out = thumb_cache_key(p)
    if out.exists():
        return out
    kind = kind_of(p)
    if kind == "image":
        if p.suffix.lower() == ".svg":
            return None  # browsers render SVG natively
        from PIL import Image, ImageOps

        try:
            with Image.open(p) as im:
                im = ImageOps.exif_transpose(im)
                if im.mode not in ("RGB", "L"):
                    im = im.convert("RGB")
                elif im.mode == "L":
                    im = im.convert("RGB")
                im.thumbnail((640, 640))
                im.save(out, "JPEG", quality=82)
            return out
        except Exception:
            return None

    if kind == "video" and shutil.which("ffmpeg"):
        for ss in ("1", "0"):
            r = run(["ffmpeg", "-y", "-ss", ss, "-i", str(p), "-frames:v", "1",
                     "-vf", "scale='min(640,iw)':-2", "-q:v", "4", str(out)])
            if r and r.returncode == 0 and out.exists():
                return out
        out.unlink(missing_ok=True)
        return None

    if kind == "audio" and shutil.which("ffmpeg"):
        r = run(["ffmpeg", "-y", "-i", str(p), "-map", "0:v:0", "-frames:v", "1",
                 "-vf", "scale='min(640,iw)':-2", "-q:v", "4", str(out)])
        if r and r.returncode == 0 and out.exists():
            return out
        out.unlink(missing_ok=True)
        return None

    if p.suffix.lower() == ".pdf" and shutil.which("pdftoppm"):
        prefix = out.with_suffix(".gen")
        gen = Path(str(prefix) + ".jpg")
        r = run(["pdftoppm", "-jpeg", "-r", "60", "-f", "1", "-l", "1",
                 "-singlefile", str(p), str(prefix)])
        if r and r.returncode == 0 and gen.exists():
            gen.replace(out)
            return out
        gen.unlink(missing_ok=True)
        return None

    return None


@app.get("/api/thumb")
@require_auth
def api_thumb():
    p = safe_path(request.args.get("path", ""))
    if not p.is_file():
        abort(404)
    out = make_thumb(p)
    if out is None or not out.exists():
        abort(404)
    resp = send_file(out, mimetype="image/jpeg", conditional=True, max_age=86400)
    resp.headers["Cache-Control"] = "private, max-age=86400"
    return resp


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def lan_ipv4_addresses():
    """Best-effort list of IPv4 addresses other devices can use to reach us."""
    found = set()
    # Address used for outbound traffic. UDP connect doesn't send any packets.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            found.add(s.getsockname()[0])
    except OSError:
        pass
    # Other addresses assigned to this host (Wi-Fi, Ethernet, etc.).
    try:
        infos = socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET, socket.SOCK_STREAM)
        found.update(info[4][0] for info in infos)
    except OSError:
        pass
    return sorted(ip for ip in found
                  if ip != "0.0.0.0" and not ip.startswith(("127.", "169.254.")))


def main():
    global LIBRARY
    ap = argparse.ArgumentParser(description="Shelf — local media server")
    ap.add_argument("--host", default="0.0.0.0",
                    help="Bind address (default: 0.0.0.0 — all interfaces; "
                         "use 127.0.0.1 for local-only access)")
    ap.add_argument("--port", type=int, default=8123)
    ap.add_argument("--library", default=None, help="Media library directory (default: ./library)")
    args = ap.parse_args()

    if args.library:
        LIBRARY = Path(args.library).expanduser().resolve()
    ensure_library()

    wildcard = args.host in ("0.0.0.0", "::", "")
    if wildcard:
        urls = [("Local", f"http://127.0.0.1:{args.port}")]
        urls += [("Network", f"http://{ip}:{args.port}") for ip in lan_ipv4_addresses()]
    else:
        urls = [("Open", f"http://{args.host}:{args.port}")]

    print("\n  Shelf — local media server\n")
    print(f"  Library : {LIBRARY}")
    for label, url in urls:
        print(f"  {label:<7} : {url}")
    if wildcard and len(urls) > 1:
        print("\n  Open a Network URL on your phone/tablet (same Wi-Fi/LAN).")
    if wildcard:
        print(f"  If another device still can't connect, allow TCP port {args.port} "
              "through this computer's firewall.")
    else:
        print("\n  This server is only reachable from this machine. "
              "Use --host 0.0.0.0 to allow other devices.")
    print()

    app.run(host=args.host, port=args.port, threaded=True, debug=False)


if __name__ == "__main__":
    main()
