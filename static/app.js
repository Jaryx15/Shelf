/* ==========================================================================
   Shelf — core: API, router, dialogs, upload, theme
   ========================================================================== */

"use strict";

/* ---------- tiny DOM helpers ---------- */

const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/* ---------- formatting ---------- */

function fmtSize(n) {
  if (n == null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return i === 0 ? `${n} B` : `${n.toFixed(n >= 100 || i >= 3 ? 0 : 1)} ${units[i]}`;
}

function fmtDate(ts) {
  const d = new Date(ts * 1000);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.getFullYear() === today.getFullYear())
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
               : `${m}:${String(s).padStart(2, "0")}`;
}

/* ---------- API ---------- */

const api = {
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => "")}`);
    return r.json();
  },
  async post(url, data) {
    const r = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data || {}),
    });
    if (!r.ok) {
      let msg = "";
      try { msg = (await r.json()).error || ""; } catch {}
      throw new Error(msg || `Request failed (${r.status})`);
    }
    return r.json();
  },
  async del(url) {
    const r = await fetch(url, { method: "DELETE" });
    if (!r.ok) throw new Error(`Delete failed (${r.status})`);
    return r.json();
  },
};

/* ---------- shared state & constants ---------- */

const KINDS = {
  folder:    { icon: "folder",       label: "Folder" },
  video:     { icon: "movie",        label: "Video" },
  audio:     { icon: "music_note",   label: "Audio" },
  image:     { icon: "image",        label: "Image" },
  document:  { icon: "description",  label: "Document" },
  file:      { icon: "description",  label: "File" },
};

const state = {
  route: { name: "home", path: "", q: "" },
  sort: localStorage.getItem("shelf.sort") || "name",
  viewMode: localStorage.getItem("shelf.view") || "grid",
  uploadDest: "",
  stats: null,
};

const mediaUrl = (path, dl = false) =>
  "/media/" + String(path).split("/").map(encodeURIComponent).join("/") + (dl ? "?dl=1" : "");
const thumbUrl = path => "/api/thumb?path=" + encodeURIComponent(path);
const encPath = path => String(path).split("/").map(encodeURIComponent).join("/");

/* ---------- toasts ---------- */

function toast(msg, opts = {}) {
  const t = el(`<div class="toast">
      <span class="material-symbols-rounded">${opts.icon || "check"}</span>
      <span>${esc(msg)}</span></div>`);
  qs("#toastHost").appendChild(t);
  setTimeout(() => {
    t.classList.add("out");
    setTimeout(() => t.remove(), 250);
  }, opts.timeout || 3200);
}

/* ---------- dialogs ---------- */

function openDialog(html, { onMount, dismissable = true } = {}) {
  const scrim = el(`<div class="scrim"><div class="dialog" role="dialog">${html}</div></div>`);
  document.body.appendChild(scrim);
  const close = () => { scrim.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape" && dismissable) { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey);
  scrim.addEventListener("pointerdown", e => { if (e.target === scrim && dismissable) close(); });
  onMount?.(scrim.querySelector(".dialog"), close);
  return { scrim, close };
}

function confirmDialog(title, body, { ok = "Delete", danger = true } = {}) {
  return new Promise(resolve => {
    const { close } = openDialog(`
      <h3>${esc(title)}</h3>
      <div class="dlg-body">${body}</div>
      <div class="dlg-actions">
        <button class="text-btn" data-act="cancel">Cancel</button>
        <button class="${danger ? "filled-btn danger-btn" : "filled-btn"}" data-act="ok">${esc(ok)}</button>
      </div>`, {
      onMount(dlg, close) {
        qs('[data-act="cancel"]', dlg).onclick = () => { close(); resolve(false); };
        qs('[data-act="ok"]', dlg).onclick = () => { close(); resolve(true); };
      },
    });
  });
}

function promptDialog(title, { label = "Name", value = "", ok = "Save" } = {}) {
  return new Promise(resolve => {
    const { close } = openDialog(`
      <h3>${esc(title)}</h3>
      <input class="text-field" type="text" value="${esc(value)}" spellcheck="false">
      <div class="dlg-actions">
        <button class="text-btn" data-act="cancel">Cancel</button>
        <button class="filled-btn" data-act="ok">${esc(ok)}</button>
      </div>`, {
      onMount(dlg, close) {
        const input = qs(".text-field", dlg);
        const done = v => { close(); resolve(v); };
        qs('[data-act="cancel"]', dlg).onclick = () => done(null);
        qs('[data-act="ok"]', dlg).onclick = () => done(input.value.trim() || null);
        input.addEventListener("keydown", e => {
          if (e.key === "Enter") done(input.value.trim() || null);
        });
        input.focus();
        const dot = value.lastIndexOf(".");
        input.setSelectionRange(0, dot > 0 ? dot : value.length);
      },
    });
  });
}

/* ---------- popup menus ---------- */

let openMenuEl = null;
function closeMenu() { openMenuEl?.remove(); openMenuEl = null; }

function menu(anchor, items) {
  closeMenu();
  const r = anchor.getBoundingClientRect();
  const m = el(`<div class="menu-panel" style="position:fixed"></div>`);
  items.forEach(it => {
    if (it === "-") { m.appendChild(el(`<div class="nav-divider" style="margin:6px 8px"></div>`)); return; }
    const btn = el(`<button class="menu-item ${it.checked ? "checked" : ""}">
        <span class="material-symbols-rounded">${it.checked ? "check" : it.icon || "circle"}</span>
        <span>${esc(it.label)}</span></button>`);
    btn.onclick = () => { closeMenu(); it.onClick?.(); };
    m.appendChild(btn);
  });
  document.body.appendChild(m);
  const mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(r.right - mw, innerWidth - mw - 8)) + "px";
  m.style.top = (r.bottom + mh > innerHeight - 8 ? r.top - mh - 6 : r.bottom + 6) + "px";
  openMenuEl = m;
  setTimeout(() => {
    document.addEventListener("pointerdown", function onOut(e) {
      if (openMenuEl !== m) return;
      if (!m.contains(e.target)) { closeMenu(); document.removeEventListener("pointerdown", onOut); }
    });
  }, 0);
}

/* ---------- router ---------- */

function parseHash() {
  const h = decodeURIComponent(location.hash.slice(1) || "/").replace(/^\/+/, "");
  const [seg, ...rest] = h.split("/");
  return { name: seg || "home", path: rest.join("/"), q: rest.join("/") };
}

function navigate(href) { location.hash = href; }

function routeTitle(r) {
  if (r.name === "home") return "Home";
  if (r.name === "browse") return r.path.split("/").filter(Boolean).pop() || "Library";
  if (r.name === "search") return "Search";
  const base = r.path.split("/").filter(Boolean).pop() || "Player";
  return base.replace(/\.[a-z0-9]+$/i, "");
}

function updateNav(r) {
  qsa("#drawerNav .nav-item").forEach(a => {
    const key = a.dataset.nav;
    const active = key === "home" ? r.name === "home"
      : r.name === "browse" && (r.path === key || r.path.startsWith(key + "/"));
    a.classList.toggle("active", active);
  });
}

async function route() {
  closeMenu();
  const r = parseHash();
  state.route = r;
  updateNav(r);
  const title = routeTitle(r);
  qs("#pageTitle").textContent = title;
  document.title = `${title} — Shelf`;
  document.body.dataset.view = r.name;

  Views.closeOverlays?.();

  try {
    if (r.name === "home") await Views.renderHome();
    else if (r.name === "browse") await Views.renderBrowse(r.path);
    else if (r.name === "search") await Views.renderSearch(r.q);
    else if (r.name === "video") await Views.renderVideo(r.path);
    else if (r.name === "doc") await Views.renderDoc(r.path);
    else if (r.name === "image") await Views.openImageViewer(r.path);
    else navigate("#/");
  } catch (err) {
    console.error(err);
    qs("#content").innerHTML = `<div class="empty-state">
      <span class="material-symbols-rounded">error</span>
      <h4>Something went wrong</h4><p>${esc(err.message)}</p></div>`;
  }
}

/* ---------- opening items ---------- */

function parentOf(path) {
  const parts = String(path).split("/");
  parts.pop();
  return parts.join("/");
}

/** Navigate to / play / download an item. */
function openItem(item, { siblings = null, playAll = false } = {}) {
  switch (item.kind) {
    case "folder":
      navigate(`#/browse/${encPath(item.path)}`); break;
    case "video":
      navigate(`#/video/${encPath(item.path)}`); break;
    case "image":
      navigate(`#/image/${encPath(item.path)}`); break;
    case "document":
      navigate(`#/doc/${encPath(item.path)}`); break;
    case "audio": {
      const tracks = siblings && playAll ? siblings : [item];
      const idx = siblings && playAll ? siblings.findIndex(t => t.path === item.path) : 0;
      Player.setQueue(tracks, Math.max(idx, 0));
      break;
    }
    default:
      window.open(mediaUrl(item.path, true), "_blank");
  }
}

/** Folder whose files make up the "play all" context for a click. */
function browseContextFolder() {
  const r = state.route;
  if (r.name === "browse") return r.path;
  if (r.name === "home") return "";
  return null;
}

/* ---------- thumbnails in cards ---------- */

function thumbHtml(item, { badge = true, hoverPlay = false } = {}) {
  const K = KINDS[item.kind] || KINDS.file;
  let inner = "";
  if (item.isDir) {
    inner = `<span class="material-symbols-rounded fallback-icon">folder</span>`;
  } else if (item.kind === "image" || item.kind === "video" ||
             item.kind === "audio" || (item.kind === "document" && item.path.toLowerCase().endsWith(".pdf"))) {
    const src = item.kind === "image" && item.path.toLowerCase().endsWith(".svg")
      ? mediaUrl(item.path) : thumbUrl(item.path);
    inner = `<img loading="lazy" src="${src}" alt="" onerror="this.remove()">
             <span class="material-symbols-rounded fallback-icon">${K.icon}</span>`;
  } else {
    inner = `<span class="material-symbols-rounded fallback-icon">${K.icon}</span>`;
  }
  const badgeHtml = badge && !item.isDir
    ? `<span class="kind-badge"><span class="material-symbols-rounded">${K.icon}</span>${K.label}</span>` : "";
  const playHtml = hoverPlay && (item.kind === "video" || item.kind === "audio")
    ? `<span class="hover-play material-symbols-rounded">play_arrow</span>` : "";
  return `<div class="thumb ${item.isDir ? "dir-thumb" : ""}">${inner}${badgeHtml}${playHtml}</div>`;
}

function markLoaded(root) {
  qsa(".thumb img, .row-thumb img", root).forEach(img => {
    if (img.complete && img.naturalWidth) img.classList.add("loaded");
    else img.addEventListener("load", () => img.classList.add("loaded"), { once: true });
  });
}

function cardHtml(item, metaLine) {
  return `<button class="media-card" data-path="${esc(item.path)}" data-kind="${item.kind}">
    ${thumbHtml(item, { hoverPlay: true })}
    <div class="card-body">
      <div class="card-name">${esc(item.name)}</div>
      <div class="card-meta">${esc(metaLine)}</div>
    </div>
  </button>`;
}

function rowHtml(item, metaLine) {
  const K = KINDS[item.kind] || KINDS.file;
  const img = (!item.isDir && ["image", "video", "audio"].includes(item.kind))
    ? `<img loading="lazy" src="${thumbUrl(item.path)}" alt="" onerror="this.remove()">` : "";
  return `<button class="row-item" data-path="${esc(item.path)}" data-kind="${item.kind}">
    <span class="row-thumb">${img || `<span class="material-symbols-rounded">${item.isDir ? "folder" : K.icon}</span>`}</span>
    <span class="row-info">
      <span class="row-name">${esc(item.name)}</span>
      <span class="row-sub">${esc(metaLine)}</span>
    </span>
    <span class="row-size">${item.isDir ? "" : fmtSize(item.size)}</span>
    <span class="icon-btn small row-menu" data-menu="${esc(item.path)}"><span class="material-symbols-rounded">more_vert</span></span>
  </button>`;
}

/** Wire clicks on a container of cards/rows. itemsById: Map path → item */
function bindItemList(container, itemsById, { onOpen } = {}) {
  container.addEventListener("click", e => {
    const menuBtn = e.target.closest(".row-menu");
    if (menuBtn) {
      e.stopPropagation();
      const item = itemsById.get(menuBtn.dataset.menu);
      if (item) Views.itemMenu(menuBtn, item, () => Views.refresh());
      return;
    }
    const card = e.target.closest("[data-path]");
    if (!card) return;
    const item = itemsById.get(card.dataset.path);
    if (!item) return;
    onOpen ? onOpen(item) : openItem(item);
  });
}

/* ---------- item context menu ---------- */

function itemMenu(anchor, item, refresh) {
  const items = [];
  if (item.kind === "audio") items.push(
    { icon: "play_arrow", label: "Play", onClick: () => openItem(item) },
    { icon: "playlist_add", label: "Play next", onClick: () => Player.enqueue([item], true) },
  );
  if (item.kind === "video") items.push(
    { icon: "play_arrow", label: "Open", onClick: () => openItem(item) },
  );
  if (item.kind === "document") items.push(
    { icon: "open_in_new", label: "Open", onClick: () => openItem(item) },
  );
  items.push(
    { icon: "download", label: "Download", onClick: () => window.open(mediaUrl(item.path, true), "_blank") },
    "-",
    { icon: "edit", label: "Rename", onClick: async () => {
        const name = await promptDialog("Rename", { label: "Name", value: item.name, ok: "Rename" });
        if (!name || name === item.name) return;
        try { await api.post("/api/rename", { path: item.path, name }); toast(`Renamed to “${name}”`); refresh?.(); }
        catch (err) { toast(err.message || "Rename failed", { icon: "error" }); }
      } },
    { icon: "delete", label: "Delete", onClick: async () => {
        const ok = await confirmDialog("Delete permanently?",
          `This will remove <b>${esc(item.name)}</b> from your library. This cannot be undone.`);
        if (!ok) return;
        try { await api.del("/api/file?path=" + encodeURIComponent(item.path)); toast("Deleted", { icon: "delete" }); refresh?.(); }
        catch (err) { toast(err.message || "Delete failed", { icon: "error" }); }
      } },
  );
  menu(anchor, items);
}

/* ---------- upload ---------- */

function xhrUpload(files, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("path", destPath);
    files.forEach(f => {
      fd.append("files", f, f.name);
      fd.append("rel", f.relPath || "");
    });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({ saved: [] }); }
      } else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(fd);
  });
}

async function doUpload(files, destPath) {
  if (!files.length) return;
  const destLabel = destPath || "Library";
  const { scrim, close } = openDialog(`
    <h3>Uploading ${files.length} file${files.length > 1 ? "s" : ""}</h3>
    <div class="dlg-body">to <b>${esc(destLabel)}</b></div>
    <div id="uploadRows"></div>
    <div class="dlg-actions"><button class="text-btn" data-act="close" disabled style="opacity:.5">Done</button></div>`,
    { dismissable: false });

  const rows = qs("#uploadRows", scrim);
  let failed = 0;
  for (const f of files) {
    const row = el(`<div class="upload-row">
        <span class="material-symbols-rounded">upload</span>
        <div style="flex:1;min-width:0">
          <div class="ur-name">${esc(f.name)}</div>
          <div class="linear-progress"><div></div></div>
        </div>
        <span class="ur-pct">0%</span></div>`);
    rows.appendChild(row);
    const bar = qs(".linear-progress > div", row), pct = qs(".ur-pct", row);
    try {
      await xhrUpload([f], destPath, p => {
        bar.style.width = (p * 100).toFixed(0) + "%";
        pct.textContent = (p * 100).toFixed(0) + "%";
      });
      qs(".material-symbols-rounded", row).textContent = "check_circle";
      qs(".material-symbols-rounded", row).style.color = "var(--primary)";
    } catch (err) {
      failed++;
      qs(".material-symbols-rounded", row).textContent = "error";
      pct.textContent = "failed";
    }
  }
  const doneBtn = qs('[data-act="close"]', scrim);
  doneBtn.disabled = false; doneBtn.style.opacity = 1;
  doneBtn.onclick = () => { close(); Views.refresh(); };
  toast(failed ? `Upload finished — ${failed} failed` : `Uploaded ${files.length} file${files.length > 1 ? "s" : ""}`,
    { icon: failed ? "error" : "check_circle" });
  refreshStorage();
}

function uploadTarget() {
  const r = state.route;
  if (r.name === "browse") return r.path;
  if (["video", "doc", "image"].includes(r.name)) return parentOf(r.path);
  return "";
}

function wireUpload() {
  const fileInput = qs("#fileInput");
  const folderInput = qs("#folderInput");

  qs("#uploadBtn").onclick = () => {
    const dest = uploadTarget();
    const { close } = openDialog(`
      <h3>Upload</h3>
      <div class="dlg-body">Files are stored in <b>/${esc(dest || "Library")}</b></div>
      <div class="drop-zone" id="dlgDrop">
        <span class="material-symbols-rounded">cloud_upload</span>
        Drop files or folders here, or click to browse
      </div>
      <div class="dlg-actions">
        <button class="text-btn" data-act="folder">Folder</button>
        <button class="text-btn" data-act="files">Choose files</button>
        <button class="tonal-btn" data-act="close">Close</button>
      </div>`, {
      onMount(dlg, close) {
        qs("#dlgDrop", dlg).onclick = () => fileInput.click();
        qs('[data-act="files"]', dlg).onclick = () => fileInput.click();
        qs('[data-act="folder"]', dlg).onclick = () => folderInput.click();
        qs('[data-act="close"]', dlg).onclick = close;
        const dz = qs("#dlgDrop", dlg);
        ["dragover", "dragenter"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("hot"); }));
        ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove("hot")));
        dz.addEventListener("drop", async e => {
          e.preventDefault();
          const files = await collectDropped(e.dataTransfer);
          close();
          doUpload(files, dest);
        });
      },
    });
  };

  fileInput.onchange = () => {
    const dest = uploadTarget();
    doUpload([...fileInput.files], dest);
    fileInput.value = "";
  };
  folderInput.onchange = () => {
    const dest = uploadTarget();
    const files = [...folderInput.files].map(f => {
      const rel = (f.webkitRelativePath || f.name).split("/");
      rel.pop();
      f.relPath = rel.join("/");
      return f;
    });
    doUpload(files, dest);
    folderInput.value = "";
  };

  /* global drag & drop */
  const overlay = qs("#dropOverlay");
  const targetLabel = qs("#dropTarget");
  let dragDepth = 0;
  window.addEventListener("dragenter", e => {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    dragDepth++;
    const dest = uploadTarget();
    targetLabel.textContent = `to /${dest || "Library"}`;
    overlay.classList.add("active");
  });
  window.addEventListener("dragover", e => { if ([...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
  window.addEventListener("dragleave", e => {
    if (--dragDepth <= 0) { dragDepth = 0; overlay.classList.remove("active"); }
  });
  window.addEventListener("drop", async e => {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.remove("active");
    const files = await collectDropped(e.dataTransfer);
    doUpload(files, uploadTarget());
  });
}

/** Recursively collect dropped files, preserving folder structure. */
async function collectDropped(dt) {
  const entries = [...(dt.items || [])]
    .map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
    .filter(Boolean);
  if (!entries.length) return [...dt.files];
  const out = [];
  const readAll = reader => new Promise(res => {
    const batch = [];
    const next = () => reader.readEntries(rs => { batch.push(...rs); rs.length ? next() : res(batch); });
    next();
  });
  async function walk(entry, prefix) {
    if (entry.isFile) {
      const f = await new Promise(res => entry.file(res));
      f.relPath = prefix;
      out.push(f);
    } else if (entry.isDirectory) {
      const sub = prefix ? `${prefix}/${entry.name}` : entry.name;
      for (const child of await readAll(entry.createReader())) await walk(child, sub);
    }
  }
  for (const e of entries) await walk(e, "");
  return out;
}

/* ---------- theme ---------- */

function applyTheme(t) {
  document.body.dataset.theme = t;
  localStorage.setItem("shelf.theme", t);
  const icon = qs("#themeBtn .material-symbols-rounded");
  if (icon) icon.textContent = t === "dark" ? "brightness_7" : "brightness_4";
}

function wireTheme() {
  applyTheme(localStorage.getItem("shelf.theme") || "dark");
  qs("#themeBtn").onclick = () =>
    applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
}

/* ---------- storage summary ---------- */

async function refreshStorage() {
  try {
    const s = await api.get("/api/stats");
    state.stats = s;
    const count = Object.values(s.kinds).reduce((a, k) => a + k.count, 0);
    qs("#storageSummary").innerHTML = `
      <div class="df-row"><span><span class="material-symbols-rounded" style="font-size:15px;vertical-align:-2px">hard_drive</span> Library</span><b>${fmtSize(s.totalSize)}</b></div>
      <div>${count} file${count === 1 ? "" : "s"} across ${esc(state.libraryDirs || "5 categories")}</div>`;
  } catch {}
}
