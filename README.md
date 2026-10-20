# Shelf

A local media server for videos, music, images, and documents. Stream with HTTP Range support, persistent music player, image/document viewer, uploads/rename/delete, and a Material 3 UI.

## Features
- **Library**: Browse Videos/Music/Images/Documents with grid/list views, search, thumbnails
- **Video**: HTML5 player with seek, volume, speed, PiP, fullscreen, auto-play next
- **Music**: Persistent player bar with queue, shuffle/repeat, play all from folders
- **Images**: Fullscreen viewer with zoom/pan/navigation
- **Documents**: View PDF (inline), Markdown, HTML, and plain text
- **Management**: Upload (files/folders/drag-drop), create folders, rename, delete, download
- **Responsive**: Mobile-friendly layout, floating upload button on small screens
- **Network access**: Listen on all interfaces (`--host 0.0.0.0`)
- **Auth (optional)**: Password protect with `SHELF_PASSWORD`

## Quick start
```bash
pip install -r requirements.txt
python3 server.py
```
Open http://127.0.0.1:8123

## Options
```bash
python3 server.py --host 0.0.0.0 --port 8123 --library ./library
```

## Password protection
```bash
SHELF_PASSWORD=yourpassword python3 server.py --host 0.0.0.0 --port 8123
```
Supports Basic auth, Bearer token, or `?token=` / cookie `shelf_token`.

## Library layout
Drop files into `library/Videos`, `library/Music`, `library/Images`, or `library/Documents` (created on first run).

## Notes
- Thumbnails generated with PIL/ffmpeg/pdftoppm (cached in `.cache/`).
- Large video/audio streaming uses HTTP Range requests.
- Designed for local/network use on trusted networks.
