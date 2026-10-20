#!/usr/bin/env python3
"""
Generate a demo library so the server has something to show:
sample images, videos, music (with cover art), a manga (CBZ + folder) and docs.

Usage:  python3 make_demo.py [--library ./library]
"""

import argparse
import math
import struct
import subprocess
import wave
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def font(size):
    for f in FONT_CANDIDATES:
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


# ---------------------------------------------------------------------------
# Small drawing helpers
# ---------------------------------------------------------------------------

def vgrad(size, top, bottom):
    w, h = size
    im = Image.new("RGB", size)
    dr = ImageDraw.Draw(im)
    for y in range(h):
        t = y / max(h - 1, 1)
        dr.line([(0, y), (w, y)], fill=tuple(
            int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return im


def wrap(draw, text, fnt, max_w):
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=fnt) <= max_w:
            line = trial
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def bubble(dr, xy, text, fnt, max_w=340):
    x, y = xy
    lines = wrap(dr, text, fnt, max_w - 40)
    tw = max(dr.textlength(l, font=fnt) for l in lines)
    th = len(lines) * (fnt.size + 8)
    w, h = tw + 40, th + 32
    dr.ellipse([x, y, x + w, y + h], fill="white", outline="black", width=3)
    dr.polygon([(x + w * 0.3, y + h - 4), (x + w * 0.22, y + h + 34),
                (x + w * 0.45, y + h - 2)], fill="white", outline="black")
    for i, line in enumerate(lines):
        dr.text((x + 20, y + 16 + i * (fnt.size + 8)), line, fill="black", font=fnt)


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------

def make_images(images_dir: Path):
    images_dir.mkdir(parents=True, exist_ok=True)

    # 1. aurora
    im = vgrad((1600, 1000), (8, 12, 40), (10, 30, 25))
    dr = ImageDraw.Draw(im)
    for i, (col, off) in enumerate([((40, 220, 140), 0), ((60, 160, 255), 200), ((160, 90, 255), 400)]):
        for x in range(0, 1600, 3):
            yoff = 250 + off + 90 * math.sin(x / 180 + i * 2)
            dr.line([(x, yoff), (x, yoff + 150)], fill=col, width=3)
    im = im.filter(ImageFilter.GaussianBlur(6))
    dr = ImageDraw.Draw(im)
    for _ in range(140):
        x, y = int(im.width * hash(str(_)) % 1600), int(im.height * (( _ * 37) % 450))
        dr.ellipse([x, y, x + 2, y + 2], fill="white")
    im.save(images_dir / "aurora_borealis.png")

    # 2. neon city
    im = vgrad((1600, 1000), (12, 8, 30), (60, 20, 80))
    dr = ImageDraw.Draw(im)
    import random
    random.seed(7)
    palette = [(0, 229, 255), (255, 0, 200), (255, 214, 90), (120, 90, 255)]
    for i in range(26):
        w = random.randint(40, 110)
        x = i * 62 + random.randint(-10, 10)
        h = random.randint(220, 620)
        col = random.choice(palette)
        dr.rectangle([x, 1000 - h, x + w, 1000], fill=(18, 14, 38))
        for wy in range(1000 - h + 20, 960, 42):
            for wx in range(x + 10, x + w - 8, 26):
                if random.random() < 0.55:
                    dr.rectangle([wx, wy, wx + 12, wy + 18], fill=col)
    im.save(images_dir / "neon_city.jpg", quality=88)

    # 3. desert dunes
    im = vgrad((1600, 1000), (255, 190, 120), (250, 120, 80))
    dr = ImageDraw.Draw(im)
    dr.ellipse([1150, 120, 1390, 360], fill=(255, 245, 210))
    for i, (col, y0, amp) in enumerate([((225, 130, 70), 600, 120), ((190, 95, 55), 730, 90), ((150, 70, 50), 860, 60)]):
        pts = [(0, 1000)]
        for x in range(0, 1601, 20):
            pts.append((x, y0 + amp * math.sin(x / 240 + i * 1.7)))
        pts.append((1600, 1000))
        dr.polygon(pts, fill=col)
    im.save(images_dir / "desert_dunes.jpg", quality=88)

    # 4. blue hour
    im = vgrad((1600, 1000), (20, 40, 110), (120, 170, 230))
    dr = ImageDraw.Draw(im)
    dr.ellipse([680, 260, 920, 500], fill=(240, 246, 255))
    pts = [(0, 1000)] + [(x, 760 + 90 * math.sin(x / 300) + 40 * math.sin(x / 90))
                         for x in range(0, 1601, 16)] + [(1600, 1000)]
    dr.polygon(pts, fill=(15, 25, 60))
    im.save(images_dir / "blue_hour.jpg", quality=88)

    # 5. minimal shapes
    im = vgrad((1600, 1000), (235, 240, 250), (215, 225, 245))
    dr = ImageDraw.Draw(im)
    dr.ellipse([220, 220, 620, 620], fill=(27, 103, 240))
    dr.rectangle([760, 300, 1160, 700], fill=(255, 180, 60))
    dr.rounded_rectangle([1220, 380, 1480, 640], radius=130, fill=(70, 190, 160))
    im.save(images_dir / "minimal_shapes.png")

    # 6. tall waterfall (for zoom testing)
    im = vgrad((900, 2400), (30, 60, 40), (10, 25, 20))
    dr = ImageDraw.Draw(im)
    dr.rectangle([400, 0, 500, 2400], fill=(200, 225, 235))
    for y in range(0, 2400, 26):
        dr.line([(380, y), (520, y + 12)], fill=(255, 255, 255, 40), width=2)
    for i, (col, y0) in enumerate([((35, 80, 50), 1900), ((25, 60, 40), 2150)]):
        pts = [(0, 2400)] + [(x, y0 + 60 * math.sin(x / 120 + i)) for x in range(0, 901, 15)] + [(900, 2400)]
        dr.polygon(pts, fill=col)
    im.save(images_dir / "tall_waterfall.png")
    print(f"  images   → {images_dir}")


# ---------------------------------------------------------------------------
# Videos (ffmpeg)
# ---------------------------------------------------------------------------

def make_videos(videos_dir: Path):
    videos_dir.mkdir(parents=True, exist_ok=True)
    clips = videos_dir / "Clips"
    clips.mkdir(exist_ok=True)
    jobs = [
        (videos_dir / "Aurora Drift.mp4",
         "mandelbrot=size=1280x720:rate=30", "sine=frequency=392:duration=18", 18),
        (clips / "Neon Test Pattern.mp4",
         "testsrc2=size=1280x720:rate=30:duration=12", "sine=frequency=523:duration=12", 12),
    ]
    for out, src, tone, dur in jobs:
        cmd = ["ffmpeg", "-y", "-f", "lavfi", "-i", src, "-f", "lavfi", "-i", tone,
               "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-b:a", "128k", "-af", "volume=0.3,tremolo=f=2:d=0.5",
               "-t", str(dur), "-shortest", "-movflags", "+faststart", str(out)]
        subprocess.run(cmd, capture_output=True, timeout=300)
        print(f"  video    → {out}")


# ---------------------------------------------------------------------------
# Music: pure-python chord pads → wav → mp3 with cover art
# ---------------------------------------------------------------------------

CHORDS = {
    "Am": [220.00, 261.63, 329.63],
    "F":  [174.61, 220.00, 261.63],
    "C":  [261.63, 329.63, 392.00],
    "G":  [196.00, 246.94, 293.66],
    "Dm": [146.83, 220.00, 293.66],
    "Em": [164.81, 246.94, 329.63],
}
PROGRESSIONS = [
    ["Am", "F", "C", "G"],
    ["C", "G", "Am", "F"],
    ["Dm", "Am", "Em", "Am"],
    ["F", "C", "Dm", "Em"],
]

SR = 44100


def render_track(chords, transpose=1.0, chord_secs=4.0):
    n_total = int(len(chords) * chord_secs * SR)
    data = []
    for i, name in enumerate(chords):
        freqs = [f * transpose for f in CHORDS[name]]
        n = int(chord_secs * SR)
        for s in range(n):
            t = s / SR
            env = min(1.0, t / 1.2) * min(1.0, (chord_secs - t) / 1.2)
            val = 0.0
            for k, f in enumerate(freqs):
                val += math.sin(2 * math.pi * f * t) * 0.09
                val += math.sin(2 * math.pi * f * 2 * t) * 0.02
            val += math.sin(2 * math.pi * freqs[0] / 2 * t) * 0.05  # bass
            val *= env * (1 + 0.08 * math.sin(2 * math.pi * 4.5 * t))  # tremolo
            data.append(val)
    data.extend([0.0] * int(0.8 * SR))  # tail
    return data


def make_music(music_dir: Path):
    album = music_dir / "Mira Vale - Paper Sessions"
    album.mkdir(parents=True, exist_ok=True)
    tracks = [
        ("01 - Paper Boats.mp3", "Paper Boats", 0, PROGRESSIONS[0]),
        ("02 - Slow Neon.mp3", "Slow Neon", 1.1225, PROGRESSIONS[1]),   # +2 semitones
        ("03 - Rooftop Rain.mp3", "Rooftop Rain", 0.8409, PROGRESSIONS[2]),  # -3 semitones
        ("04 - First Light.mp3", "First Light", 1.3348, PROGRESSIONS[3]),  # +5 semitones
    ]
    covers = []
    for i, (fname, title, tr, prog) in enumerate(tracks):
        # cover art
        col = [(27, 103, 240), (120, 80, 220), (20, 150, 170), (230, 120, 60)][i]
        cover = vgrad((500, 500), col, tuple(max(0, c - 90) for c in col))
        cd = ImageDraw.Draw(cover)
        cd.ellipse([150, 150, 350, 350], outline="white", width=6)
        cd.text((250, 430), "MIRA VALE", fill="white", font=font(30), anchor="mm")
        cover_path = Path("/tmp") / f"cover_{i}.jpg"
        cover.save(cover_path, quality=85)
        covers.append(cover_path)

        samples = render_track(prog, transpose=tr)
        wav_path = Path("/tmp") / f"track_{i}.wav"
        with wave.open(str(wav_path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(b"".join(struct.pack("<h", max(-32767, min(32767, int(s * 32767)))) for s in samples))

        subprocess.run([
            "ffmpeg", "-y", "-i", str(wav_path), "-i", str(cover_path),
            "-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-q:a", "4",
            "-metadata", f"title={title}", "-metadata", "artist=Mira Vale",
            "-metadata", "album=Paper Sessions", "-metadata", f"track={i + 1}",
            "-id3v2_version", "3", "-disposition:v", "attached_pic",
            str(album / fname),
        ], capture_output=True, timeout=180)
        wav_path.unlink(missing_ok=True)
        cover_path.unlink(missing_ok=True)
        print(f"  music    → {album / fname}")


# ---------------------------------------------------------------------------
# Manga
# ---------------------------------------------------------------------------

def comic_page(page_no, lines, title_page=False, sky=((25, 30, 60), (90, 60, 120))):
    W, H = 1000, 1400
    im = Image.new("RGB", (W, H), "white")
    dr = ImageDraw.Draw(im)
    f_panel, f_bub = font(22), font(24)

    def panel(rect, draw_fn):
        x0, y0, x1, y1 = rect
        sub = vgrad((x1 - x0, y1 - y0), *sky)
        draw_fn(sub, ImageDraw.Draw(sub))
        im.paste(sub, (x0, y0))
        dr.rectangle(rect, outline="black", width=5)

    def city(s, sd):
        sd.rectangle([0, s.height * 0.62, s.width, s.height], fill=(15, 15, 30))
        x = 0
        while x < s.width:
            w = 60 + (x * 37) % 90
            h = 80 + (x * 53) % 220
            sd.rectangle([x, s.height * 0.62 - h, x + w, s.height], fill=(25, 25, 45))
            for wy in range(int(s.height * 0.62 - h) + 12, int(s.height * 0.62), 30):
                for wx in range(x + 8, x + w - 8, 24):
                    if (wx + wy) % 5 < 2:
                        sd.rectangle([wx, wy, wx + 10, wy + 14], fill=(255, 210, 90))
            x += w + 14
        sd.ellipse([s.width - 210, 60, s.width - 90, 180], fill=(240, 240, 255))

    def rain(s, sd):
        city(s, sd)
        for i in range(0, s.width + s.height, 26):
            sd.line([(i, 0), (i - 200, s.height)], fill=(170, 190, 230), width=2)

    def closeup(s, sd):
        sd.ellipse([-200, -100, s.width + 200, s.height + 200], fill=(240, 230, 220))
        sd.ellipse([s.width * 0.25, s.height * 0.3, s.width * 0.75, s.height * 0.65],
                   fill="white", outline="black", width=6)
        sd.ellipse([s.width * 0.42, s.height * 0.38, s.width * 0.58, s.height * 0.57],
                   fill=(30, 60, 140))
        sd.ellipse([s.width * 0.47, s.height * 0.42, s.width * 0.53, s.height * 0.5],
                   fill="black")

    if title_page:
        dr.rectangle([60, 60, W - 60, 560], fill=(20, 25, 55))
        dr.text((W // 2, 180), "NIGHT CITY BLUES", fill=(120, 200, 255), font=font(64), anchor="mm")
        dr.text((W // 2, 270), "chapter one — static", fill=(200, 210, 240), font=font(34), anchor="mm")
        dr.ellipse([W // 2 - 90, 330, W // 2 + 90, 510], fill=(255, 210, 90))
        dr.text((W // 2, 640), f"— page {page_no} —", fill="black", font=font(26), anchor="mm")
        panel((60, 700, W - 60, 1300), city)
    else:
        layout = [((60, 60, W - 60, 560), city), ((60, 590, W - 60, 960), closeup),
                  ((60, 990, W - 60, 1340), rain)]
        for rect, fn in layout:
            panel(rect, fn)
        y = 120
        for text in lines[:2]:
            bubble(dr, (70, y), text, f_bub)
            y += 400

    dr.text((W - 80, H - 50), f"{page_no}", fill="gray", font=f_panel, anchor="mm")
    return im


def make_manga(manga_dir: Path):
    manga_dir.mkdir(parents=True, exist_ok=True)

    # CBZ
    series = manga_dir / "Night City Blues"
    series.mkdir(exist_ok=True)
    story = [
        "The rain never stops in this city.",
        "You said you'd wait for me by the arcade.",
        "Every neon sign hides a broken promise.",
        "I found your notebook in the old station.",
        "Don't look back. Keep running.",
        "Somewhere, the sun still rises.",
    ]
    cbz_path = series / "Night City Blues - c01.cbz"
    with zipfile.ZipFile(cbz_path, "w", zipfile.ZIP_STORED) as zf:
        for i in range(1, 9):
            page = comic_page(i, story[i - 1:i + 1], title_page=(i == 1))
            p = Path("/tmp") / f"ncb_{i:03d}.jpg"
            page.save(p, quality=85)
            zf.write(p, f"page_{i:03d}.jpg")
            p.unlink(missing_ok=True)
    print(f"  manga    → {cbz_path}")

    # Folder-based series
    drift = manga_dir / "Solar Drift"
    drift.mkdir(exist_ok=True)
    for i in range(1, 7):
        page = comic_page(i, story[:2], title_page=(i == 1), sky=((60, 30, 90), (240, 130, 90)))
        page.save(drift / f"solar_drift_{i:03d}.jpg", quality=85)
    print(f"  manga    → {drift}")


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

def make_documents(docs_dir: Path):
    docs_dir.mkdir(parents=True, exist_ok=True)

    (docs_dir / "Getting Started.txt").write_text("""SHELF — Getting Started
======================

Welcome! This is your local media server.

* Drop files here (or use the Upload button) to store videos,
  images, documents, music and manga.
* Click a video or song to play it right in the browser.
* Open any .cbz or folder of images as a manga reader.

Keyboard shortcuts
------------------
Video:  Space play/pause · ← → seek · F fullscreen · M mute
Manga:  ← → pages · Space next · 1/2 single/double · S strip
Music:  Media keys work when a song is playing.
""")

    (docs_dir / "Field Notes.md").write_text("""# Field Notes

A **markdown** document — rendered right inside Shelf.

## Why local?

- No cloud, no accounts, no waiting.
- Everything is served from *your machine*.
- Works fully offline (fonts fall back gracefully).

## A little code

```python
def greet(name):
    return f"Hello, {name}!"
```

## Checklist

1. Upload some files
2. Play a song
3. Read a chapter

> "The best server is the one running on your own desk."
""")

    # PDF via PIL
    pages = []
    for i, (title, body) in enumerate([
        ("Blueprint 01 — Server", "Flask serves the UI, the API and the media\nwith full HTTP Range support."),
        ("Blueprint 02 — Reader", "CBZ archives and image folders are read\npage-by-page, RTL or LTR."),
    ]):
        im = Image.new("RGB", (1240, 1754), "white")
        dr = ImageDraw.Draw(im)
        dr.rectangle([70, 70, 1170, 1684], outline=(27, 103, 240), width=6)
        dr.text((120, 150), title, fill=(20, 40, 90), font=font(56))
        for j, line in enumerate(body.split("\n")):
            dr.text((120, 300 + j * 60), line, fill="black", font=font(36))
        dr.text((1170, 1600), f"page {i + 1}", fill="gray", font=font(30), anchor="ra")
        pages.append(im)
    pages[0].save(docs_dir / "Blueprints.pdf", save_all=True, append_images=pages[1:])
    print(f"  documents→ {docs_dir}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--library", default=None)
    args = ap.parse_args()
    lib = Path(args.library).resolve() if args.library else ROOT / "library"
    print(f"Generating demo library in {lib} ...")
    make_images(lib / "Images")
    make_videos(lib / "Videos")
    make_music(lib / "Music")
    make_manga(lib / "Manga")
    make_documents(lib / "Documents")
    print("Done.")


if __name__ == "__main__":
    main()
