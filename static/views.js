/* ==========================================================================
   Shelf — views: home, browse, search, video, documents, image viewer
   ========================================================================== */

"use strict";

const Views = (() => {
  const content = () => document.getElementById("content");
  let cleanups = [];

  function onCleanup(fn) { cleanups.push(fn); }

  function closeOverlays() {
    cleanups.forEach(fn => { try { fn(); } catch {} });
    cleanups = [];
    document.getElementById("overlayRoot").innerHTML = "";
    document.getElementById("queueDrawer").classList.remove("open");
  }

  function refresh() {
    const r = state.route;
    if (r.name === "browse") renderBrowse(r.path);
    else if (r.name === "home") renderHome();
    else if (r.name === "search") renderSearch(r.q);
  }

  /* ---------- shared item list rendering ---------- */

  const SORTS = {
    name:     { label: "Name (A–Z)",        fn: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) },
    newest:   { label: "Newest first",      fn: (a, b) => b.mtime - a.mtime },
    oldest:   { label: "Oldest first",      fn: (a, b) => a.mtime - b.mtime },
    largest:  { label: "Largest first",     fn: (a, b) => b.size - a.size },
    smallest: { label: "Smallest first",    fn: (a, b) => a.size - b.size },
  };

  function sorted(items, foldersFirst = true) {
    const arr = items.slice().sort(SORTS[state.sort]?.fn || SORTS.name.fn);
    return foldersFirst ? [...arr.filter(i => i.isDir), ...arr.filter(i => !i.isDir)] : arr;
  }

  function metaLine(item) {
    if (item.isDir) return "Folder";
    return `${fmtSize(item.size)} · ${fmtDate(item.mtime)}`;
  }

  function renderItems(container, items) {
    const map = new Map(items.map(i => [i.path, i]));
    container.innerHTML = items.length === 0 ? "" :
      state.viewMode === "list"
        ? `<div class="list-rows">${items.map(i => rowHtml(i, metaLine(i))).join("")}</div>`
        : `<div class="card-grid">${items.map(i => cardHtml(i, metaLine(i))).join("")}</div>`;
    if (!items.length) return;
    markLoaded(container);
    // audio items: playing a file plays the whole folder as a queue
    bindItemList(container, map, {
      onOpen(item) {
        if (item.kind === "audio") {
          const tracks = items.filter(i => i.kind === "audio");
          Player.setQueue(tracks, tracks.findIndex(t => t.path === item.path));
        } else openItem(item);
      },
    });
    Player.syncRows();
  }

  /* ---------- home ---------- */

  const CATS = [
    { dir: "Videos",    kind: "video",     icon: "movie" },
    { dir: "Music",     kind: "audio",     icon: "music_note" },
    { dir: "Images",    kind: "image",     icon: "image" },
    { dir: "Documents", kind: "document",  icon: "description" },
  ];

  async function renderHome() {
    const [stats, recent] = await Promise.all([
      api.get("/api/stats"), api.get("/api/recent"),
    ]);
    state.stats = stats;
    const total = Object.values(stats.kinds).reduce((a, k) => a + k.count, 0);
    const hour = new Date().getHours();
    const greet = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

    const tiles = CATS.map(c => {
      const k = stats.kinds[c.kind] || { count: 0, size: 0 };
      return `<button class="cat-tile" data-dir="${c.dir}" ${c.href ? `data-href="${c.href}"` : ""}>
        <span class="cat-icon"><span class="material-symbols-rounded">${c.icon}</span></span>
        <span><strong>${c.dir}</strong><small>${k.count} item${k.count === 1 ? "" : "s"} · ${fmtSize(k.size)}</small></span>
      </button>`;
    }).join("");

    const recentCards = recent.items.length
      ? `<div class="h-scroll" id="recentRow">${recent.items.map(i => cardHtml(i, metaLine(i))).join("")}</div>`
      : `<div class="empty-state" style="padding:30px"><p>Nothing yet — open a category or upload files.</p></div>`;

    content().innerHTML = `<div class="view-enter">
      <div class="home-hero">
        <h2>${greet}</h2>
        <p>Your library is served locally from this machine.</p>
        <div class="stat-chips">
          <span class="stat-chip"><span class="material-symbols-rounded">hard_drive</span><b>${fmtSize(stats.totalSize)}</b> used</span>
          <span class="stat-chip"><span class="material-symbols-rounded">folder</span><b>${total}</b> files</span>
          <span class="stat-chip"><span class="material-symbols-rounded">movie</span><b>${stats.kinds.video.count}</b> videos</span>
          <span class="stat-chip"><span class="material-symbols-rounded">music_note</span><b>${stats.kinds.audio.count}</b> songs</span>
        </div>
      </div>
      <div class="section-head"><h3>Browse</h3></div>
      <div class="cat-grid">${tiles}</div>
      <div class="section-head"><h3>Recently added</h3></div>
      ${recentCards}
    </div>`;

    qsa(".cat-tile", content()).forEach(t => t.onclick = () =>
      navigate(t.dataset.href || `#/browse/${encPath(t.dataset.dir)}`));
    const row = qs("#recentRow", content());
    if (row) {
      const map = new Map(recent.items.map(i => [i.path, i]));
      markLoaded(row);
      bindItemList(row, map, {
        onOpen(item) {
          if (item.kind === "audio") Player.setQueue([item], 0);
          else openItem(item);
        },
      });
    }
  }

  /* ---------- browse ---------- */

  async function renderBrowse(path) {
    const data = await api.get("/api/list?path=" + encodeURIComponent(path));
    const items = sorted(data.items);
    const isRoot = !path;
    const segs = path.split("/").filter(Boolean);

    const crumbs = [`<a href="#/">Home</a>`].concat(
      segs.map((s, i) => {
        const href = `#/browse/${encPath(segs.slice(0, i + 1).join("/"))}`;
        const last = i === segs.length - 1;
        return `<span class="material-symbols-rounded crumb-sep">chevron_right</span>` +
          (last ? `<span class="current">${esc(s)}</span>` : `<a href="${href}">${esc(s)}</a>`);
      }),
    ).join("");

    const viewIcon = state.viewMode === "grid" ? "view_list" : "grid_view";
    content().innerHTML = `<div class="view-enter">
      <div class="breadcrumbs">${crumbs}</div>
      <div class="toolbar-row">
        <button class="tonal-btn" id="btnNewFolder"><span class="material-symbols-rounded">create_new_folder</span>New folder</button>
        <button class="outlined-btn" id="btnUploadHere"><span class="material-symbols-rounded">upload</span>Upload</button>
        <div class="spacer"></div>
        <span class="count-label">${items.length} item${items.length === 1 ? "" : "s"}</span>
        <div class="menu-anchor"><button class="icon-btn" id="btnSort" title="Sort"><span class="material-symbols-rounded">sort</span></button></div>
        <button class="icon-btn" id="btnView" title="Switch view"><span class="material-symbols-rounded">${viewIcon}</span></button>
      </div>
      <div id="browseList"></div>
    </div>`;

    const listEl = qs("#browseList", content());
    if (items.length === 0) {
      listEl.innerHTML = `<div class="empty-state">
        <span class="material-symbols-rounded">folder_open</span>
        <h4>${isRoot ? "Your library is empty" : "This folder is empty"}</h4>
        <p>Drag & drop files anywhere, or use the Upload button.</p>
        <button class="filled-btn" id="emptyUpload" style="margin-top:10px"><span class="material-symbols-rounded">upload</span>Upload files</button>
      </div>`;
      qs("#emptyUpload", listEl).onclick = () => qs("#uploadBtn").click();
    } else {
      renderItems(listEl, items);
    }

    qs("#btnSort").onclick = e => menu(e.currentTarget, Object.entries(SORTS).map(([key, s]) => ({
      icon: "sort", label: s.label, checked: state.sort === key,
      onClick: () => { state.sort = key; localStorage.setItem("shelf.sort", key); renderBrowse(path); },
    })));
    qs("#btnView").onclick = () => {
      state.viewMode = state.viewMode === "grid" ? "list" : "grid";
      localStorage.setItem("shelf.view", state.viewMode);
      renderBrowse(path);
    };
    qs("#btnUploadHere").onclick = () => qs("#uploadBtn").click();
    qs("#btnNewFolder").onclick = async () => {
      const name = await promptDialog("New folder", { label: "Folder name", value: "", ok: "Create" });
      if (!name) return;
      try { await api.post("/api/mkdir", { path, name }); toast("Folder created"); renderBrowse(path); }
      catch (err) { toast(err.message || "Could not create folder", { icon: "error" }); }
    };
  }

  /* ---------- search ---------- */

  async function renderSearch(q) {
    if (!q.trim()) { navigate("#/"); return; }
    const data = await api.get("/api/search?q=" + encodeURIComponent(q));
    const items = data.items;
    content().innerHTML = `<div class="view-enter">
      <div class="section-head" style="margin-top:18px"><h3>Results for “${esc(q)}”</h3>
        <span class="count-label">${items.length} match${items.length === 1 ? "" : "es"}</span></div>
      ${items.length ? "" : `<div class="empty-state">
        <span class="material-symbols-rounded">search_off</span>
        <h4>No matches</h4><p>Try a different search term.</p></div>`}
      <div id="searchList"></div>
    </div>`;
    const listEl = qs("#searchList", content());
    if (items.length) renderItems(listEl, items);
  }

  /* ---------- video ---------- */

  async function renderVideo(path) {
    const parent = parentOf(path);
    const data = await api.get("/api/list?path=" + encodeURIComponent(parent));
    const videos = data.items.filter(i => i.kind === "video");
    const current = data.items.find(i => i.path === path);
    if (!current) { navigate(`#/browse/${encPath(parent)}`); return; }
    const idx = videos.findIndex(v => v.path === path);

    const sideItems = videos.map(v => `
      <button class="side-item ${v.path === path ? "current" : ""}" data-side="${esc(v.path)}">
        <span class="row-thumb"><img loading="lazy" src="${thumbUrl(v.path)}" alt="" onerror="this.remove()"><span class="material-symbols-rounded">movie</span></span>
        <span class="row-info"><span class="row-name">${esc(v.name)}</span>
        <span class="row-sub">${fmtSize(v.size)}</span></span>
      </button>`).join("");

    content().innerHTML = `<div class="view-enter watch-layout">
      <div class="watch-main">
        <div class="breadcrumbs">
          <a href="#/">Home</a><span class="material-symbols-rounded crumb-sep">chevron_right</span>
          <a href="#/browse/${encPath(parent)}">${esc(data.name)}</a>
          <span class="material-symbols-rounded crumb-sep">chevron_right</span>
          <span class="current">${esc(current.name)}</span>
        </div>
        <div class="stage" id="stage">
          <video id="video" preload="metadata" playsinline src="${mediaUrl(path)}"></video>
          <button class="big-play" id="bigPlay"><span class="material-symbols-rounded">play_arrow</span></button>
          <div class="vc" id="vc">
            <div class="vc-row" style="padding:0 4px">
              <input type="range" class="seek-slider" id="vSeek" min="0" max="1000" value="0" aria-label="Seek">
            </div>
            <div class="vc-row">
              <button class="icon-btn" id="vPlay"><span class="material-symbols-rounded">play_arrow</span></button>
              <button class="icon-btn" id="vPrev" ${idx <= 0 ? "disabled style=opacity:.35" : ""} title="Previous (P)"><span class="material-symbols-rounded">skip_previous</span></button>
              <button class="icon-btn" id="vNext" ${idx >= videos.length - 1 ? "disabled style=opacity:.35" : ""} title="Next (N)"><span class="material-symbols-rounded">skip_next</span></button>
              <span class="vc-time" id="vTime">0:00 / 0:00</span>
              <span class="spacer"></span>
              <span class="vc-title">${esc(current.name)}</span>
              <span class="spacer"></span>
              <button class="icon-btn" id="vMute"><span class="material-symbols-rounded">volume_up</span></button>
              <input type="range" class="vol-slider" id="vVol" min="0" max="1" step="0.01" value="1" aria-label="Volume">
              <button class="icon-btn" id="vSpeed" title="Playback speed"><span class="material-symbols-rounded">speed</span></button>
              <button class="icon-btn" id="vPip" title="Picture-in-picture"><span class="material-symbols-rounded">picture_in_picture_alt</span></button>
              <button class="icon-btn" id="vFs" title="Fullscreen (F)"><span class="material-symbols-rounded">fullscreen</span></button>
            </div>
          </div>
        </div>
        <h2 style="font-size:18px;font-weight:500;margin:16px 2px 2px">${esc(current.name)}</h2>
        <div class="watch-meta">${fmtSize(current.size)} · ${new Date(current.mtime * 1000).toLocaleString()}${idx + 1 <= videos.length ? ` · Video ${idx + 1} of ${videos.length}` : ""}</div>
      </div>
      <aside class="watch-side">
        <h4>Up next in ${esc(data.name)}</h4>
        ${sideItems || "<p style='color:var(--on-surface-variant);font-size:13px'>No other videos here.</p>"}
      </aside>
    </div>`;

    /* --- video wiring --- */
    const stage = qs("#stage"), video = qs("#video");
    const seek = qs("#vSeek"), timeEl = qs("#vTime");

    const setPlayIcon = () => {
      const playing = !video.paused && !video.ended;
      qs("#vPlay .material-symbols-rounded").textContent = playing ? "pause" : "play_arrow";
      stage.classList.toggle("playing", playing);
      if (playing) armHide();
    };
    const toggle = () => { video.paused ? video.play().catch(() => {}) : video.pause(); };

    qs("#vPlay").onclick = toggle;
    qs("#bigPlay").onclick = toggle;
    video.addEventListener("click", toggle);
    video.addEventListener("play", setPlayIcon);
    video.addEventListener("pause", () => { setPlayIcon(); stage.classList.remove("hide-chrome"); });
    video.addEventListener("ended", () => { if (idx + 1 < videos.length) navigate(`#/video/${encPath(videos[idx + 1].path)}`); });

    video.addEventListener("timeupdate", () => {
      const pct = video.duration ? video.currentTime / video.duration : 0;
      seek.value = Math.round(pct * 1000);
      seek.style.setProperty("--fill", (pct * 100).toFixed(2) + "%");
      timeEl.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
    });
    video.addEventListener("loadedmetadata", () => {
      timeEl.textContent = `0:00 / ${fmtTime(video.duration)}`;
    });
    seek.addEventListener("input", () => {
      if (video.duration) video.currentTime = (seek.value / 1000) * video.duration;
    });

    const vol = qs("#vVol");
    vol.style.setProperty("--fill", "100%");
    vol.oninput = () => {
      video.volume = parseFloat(vol.value);
      video.muted = false;
      vol.style.setProperty("--fill", (vol.value * 100) + "%");
      volIcon();
    };
    const volIcon = () => {
      qs("#vMute .material-symbols-rounded").textContent =
        video.muted || video.volume === 0 ? "volume_off" : video.volume < 0.5 ? "volume_down" : "volume_up";
    };
    qs("#vMute").onclick = () => { video.muted = !video.muted; volIcon(); };

    qs("#vSpeed").onclick = e => menu(e.currentTarget, [0.5, 0.75, 1, 1.25, 1.5, 2].map(sp => ({
      icon: "speed", label: `${sp}×`, checked: video.playbackRate === sp,
      onClick: () => { video.playbackRate = sp; toast(`Speed ${sp}×`, { icon: "speed", timeout: 1500 }); },
    })));
    qs("#vPip").onclick = () => {
      if (document.pictureInPictureElement) document.exitPictureInPicture();
      else video.requestPictureInPicture?.().catch(() => toast("PiP unavailable", { icon: "error" }));
    };
    qs("#vFs").onclick = () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else stage.requestFullscreen?.();
    };
    document.addEventListener("fullscreenchange", onFs);
    function onFs() {
      const icon = qs("#vFs .material-symbols-rounded");
      if (icon) icon.textContent = document.fullscreenElement ? "fullscreen_exit" : "fullscreen";
    }
    onCleanup(() => document.removeEventListener("fullscreenchange", onFs));

    const goPrev = () => idx > 0 && navigate(`#/video/${encPath(videos[idx - 1].path)}`);
    const goNext = () => idx + 1 < videos.length && navigate(`#/video/${encPath(videos[idx + 1].path)}`);
    qs("#vPrev").onclick = goPrev;
    qs("#vNext").onclick = goNext;

    qsa("[data-side]").forEach(b => b.onclick = () => navigate(`#/video/${encPath(b.dataset.side)}`));

    /* autohide chrome */
    let hideTimer = null;
    const armHide = () => {
      stage.classList.remove("hide-chrome");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!video.paused) stage.classList.add("hide-chrome");
      }, 2600);
    };
    stage.addEventListener("mousemove", armHide);
    onCleanup(() => clearTimeout(hideTimer));

    /* keyboard */
    const onKey = e => {
      if (e.target?.matches?.("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if (k === " " || k === "k") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); video.currentTime += 5; armHide(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); video.currentTime -= 5; armHide(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); video.volume = Math.min(1, video.volume + .1); vol.value = video.volume; volIcon(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); video.volume = Math.max(0, video.volume - .1); vol.value = video.volume; volIcon(); }
      else if (k === "f") qs("#vFs").click();
      else if (k === "m") qs("#vMute").click();
      else if (k === "n") goNext();
      else if (k === "p") goPrev();
      else if (k === "j") video.currentTime -= 10;
      else if (k === "l") video.currentTime += 10;
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
    setPlayIcon();
  }

  /* ---------- documents ---------- */

  function renderMd(src) {
    // Escape everything first, then apply a small markdown subset.
    let out = "", inCode = false, inList = null, para = [];
    const flushPara = () => {
      if (para.length) { out += `<p>${inline(para.join(" "))}</p>`; para = []; }
    };
    const closeList = () => { if (inList) { out += `</${inList}>`; inList = null; } };
    const inline = s => s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    for (const raw of esc(src).split("\n")) {
      const line = raw;
      if (line.startsWith("```")) {
        flushPara(); closeList();
        out += inCode ? "</code></pre>" : '<pre><code>';
        inCode = !inCode;
        continue;
      }
      if (inCode) { out += line + "\n"; continue; }
      if (/^#{1,6}\s/.test(line)) {
        flushPara(); closeList();
        const lvl = Math.min(line.match(/^#+/)[0].length, 3);
        out += `<h${lvl}>${inline(line.replace(/^#{1,6}\s/, ""))}</h${lvl}>`;
      } else if (/^\s*[-*]\s+/.test(line)) {
        flushPara();
        if (inList !== "ul") { closeList(); out += "<ul>"; inList = "ul"; }
        out += `<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`;
      } else if (/^\s*\d+[.)]\s+/.test(line)) {
        flushPara();
        if (inList !== "ol") { closeList(); out += "<ol>"; inList = "ol"; }
        out += `<li>${inline(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>`;
      } else if (line.startsWith("&gt;")) {
        flushPara(); closeList();
        out += `<blockquote>${inline(line.replace(/^&gt;\s?/, ""))}</blockquote>`;
      } else if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
        flushPara(); closeList();
        out += "<hr>";
      } else if (line.trim() === "") {
        flushPara(); closeList();
      } else {
        closeList();
        para.push(line);
      }
    }
    flushPara(); closeList();
    if (inCode) out += "</code></pre>";
    return out;
  }

  async function renderDoc(path) {
    const name = path.split("/").pop();
    const ext = (name.split(".").pop() || "").toLowerCase();
    const isPdf = ext === "pdf";
    const isMd = ["md", "markdown"].includes(ext);
    const isHtml = ["html", "htm"].includes(ext);
    const isText = !isPdf && !isMd && !isHtml;

    content().innerHTML = `<div class="view-enter doc-wrap">
      <div class="doc-toolbar">
        <button class="icon-btn" id="docBack"><span class="material-symbols-rounded">arrow_back</span></button>
        <h2>${esc(name)}</h2>
        <button class="outlined-btn" id="docDownload"><span class="material-symbols-rounded">download</span>Download</button>
      </div>
      <div id="docBody"><div class="empty-state"><span class="material-symbols-rounded">hourglass_empty</span><p>Loading…</p></div></div>
    </div>`;

    qs("#docBack").onclick = () => history.back();
    qs("#docDownload").onclick = () => window.open(mediaUrl(path, true), "_blank");
    const body = qs("#docBody");

    if (isPdf) {
      body.innerHTML = `<iframe class="doc-frame" src="${mediaUrl(path)}" title="${esc(name)}"></iframe>`;
      return;
    }
    let text = "";
    try {
      const r = await fetch(mediaUrl(path));
      text = await r.text();
    } catch {
      body.innerHTML = `<div class="empty-state"><span class="material-symbols-rounded">error</span><h4>Could not read file</h4></div>`;
      return;
    }
    if (isHtml) {
      body.innerHTML = "";
      const frame = el(`<iframe class="doc-frame" sandbox="allow-same-origin" title="${esc(name)}"></iframe>`);
      frame.srcdoc = text;
      body.appendChild(frame);
    } else if (isMd) {
      body.innerHTML = `<div class="doc-paper md-body">${renderMd(text)}</div>`;
    } else {
      const pre = document.createElement("pre");
      pre.className = "doc-paper";
      const inner = document.createElement("code");
      inner.textContent = text.slice(0, 500000);
      pre.appendChild(inner);
      body.innerHTML = "";
      body.appendChild(pre);
    }
  }

  /* ---------- image viewer ---------- */

  function openImageViewer(path) {
    const parent = parentOf(path);
    let images = [], idx = 0;
    let zoom = 1, tx = 0, ty = 0;

    const overlay = el(`<div class="img-viewer">
      <div class="iv-bar">
        <button class="icon-btn" id="ivClose"><span class="material-symbols-rounded">arrow_back</span></button>
        <span class="name"></span>
        <span class="pos"></span>
        <button class="icon-btn" id="ivZoomOut"><span class="material-symbols-rounded">zoom_out</span></button>
        <button class="icon-btn" id="ivZoomIn"><span class="material-symbols-rounded">zoom_in</span></button>
        <button class="icon-btn" id="ivFit"><span class="material-symbols-rounded">fit_screen</span></button>
        <button class="icon-btn" id="ivDownload"><span class="material-symbols-rounded">download</span></button>
      </div>
      <div class="iv-stage" id="ivStage">
        <button class="iv-nav prev" id="ivPrev"><span class="material-symbols-rounded">chevron_left</span></button>
        <div class="iv-imgwrap" id="ivWrap"><img id="ivImg" alt=""></div>
        <button class="iv-nav next" id="ivNext"><span class="material-symbols-rounded">chevron_right</span></button>
      </div>
    </div>`);
    document.getElementById("overlayRoot").appendChild(overlay);

    const img = qs("#ivImg", overlay), wrap = qs("#ivWrap", overlay), nameEl = qs(".name", overlay), posEl = qs(".pos", overlay);
    const stage = qs("#ivStage", overlay);

    const apply = () => {
      wrap.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`;
    };
    const setZoom = z => { zoom = Math.max(0.25, Math.min(8, z)); apply(); };
    const show = () => {
      const item = images[idx];
      if (!item) return;
      zoom = 1; tx = ty = 0; apply();
      img.src = mediaUrl(item.path);
      nameEl.textContent = item.name;
      posEl.textContent = `${idx + 1} / ${images.length}`;
      qs("#ivPrev", overlay).style.visibility = idx > 0 ? "visible" : "hidden";
      qs("#ivNext", overlay).style.visibility = idx < images.length - 1 ? "visible" : "hidden";
      if (idx + 1 < images.length) new Image().src = mediaUrl(images[idx + 1].path);
    };
    const nav = d => { idx = Math.max(0, Math.min(images.length - 1, idx + d)); show(); };

    qs("#ivClose", overlay).onclick = () => history.back();
    qs("#ivPrev", overlay).onclick = () => nav(-1);
    qs("#ivNext", overlay).onclick = () => nav(1);
    qs("#ivZoomIn", overlay).onclick = () => setZoom(zoom + 0.35);
    qs("#ivZoomOut", overlay).onclick = () => setZoom(zoom - 0.35);
    qs("#ivFit", overlay).onclick = () => { zoom = 1; tx = ty = 0; apply(); };
    qs("#ivDownload", overlay).onclick = () => window.open(mediaUrl(images[idx].path, true), "_blank");

    stage.addEventListener("wheel", e => {
      e.preventDefault();
      setZoom(zoom * (e.deltaY < 0 ? 1.12 : 0.89));
    }, { passive: false });
    img.addEventListener("dblclick", () => setZoom(zoom > 1 ? 1 : 2.2));

    let drag = null;
    wrap.addEventListener("pointerdown", e => {
      if (zoom <= 1) return;
      drag = { x: e.clientX - tx, y: e.clientY - ty };
      wrap.setPointerCapture(e.pointerId);
      wrap.style.cursor = "grabbing";
    });
    wrap.addEventListener("pointermove", e => {
      if (!drag) return;
      tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply();
    });
    wrap.addEventListener("pointerup", () => { drag = null; wrap.style.cursor = ""; });

    const onKey = e => {
      if (e.key === "Escape") { e.stopPropagation(); history.back(); }
      else if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); nav(1); }
      else if (e.key === "ArrowLeft") nav(-1);
      else if (e.key === "+" || e.key === "=") setZoom(zoom + 0.35);
      else if (e.key === "-") setZoom(zoom - 0.35);
    };
    document.addEventListener("keydown", onKey);

    (async () => {
      const data = await api.get("/api/list?path=" + encodeURIComponent(parent));
      images = data.items.filter(i => i.kind === "image");
      idx = images.findIndex(i => i.path === path);
      if (idx < 0) { history.back(); return; }
      show();
    })();
  }

  /* ---------- manga library (cover grid) ---------- */

  async function renderMangaLibrary() {
    const data = await api.get("/api/manga/library");
    const items = data.items;
    const coverUrl = it => `/api/manga/cover?path=${encodeURIComponent(it.path)}&v=${it.coverMtime || 0}`;

    const cards = items.map(it => `
      <button class="manga-card" data-series="${esc(it.path)}">
        <span class="manga-cover">
          <img loading="lazy" src="${coverUrl(it)}" alt="" onerror="this.remove()">
          <span class="material-symbols-rounded fallback-icon">menu_book</span>
          <span class="hover-play"><span class="material-symbols-rounded">play_arrow</span></span>
          <span class="mc-badge"><span class="material-symbols-rounded">auto_stories</span>${it.chapters.length}</span>
          <span class="mc-cover-btn" data-cover="${esc(it.path)}" title="Cover options"><span class="material-symbols-rounded">image</span></span>
        </span>
        <span class="manga-name">${esc(it.name)}</span>
        <span class="manga-sub">${it.chapters.length === 1
          ? (it.chapters[0].pages || "?") + " pages"
          : it.chapters.length + " chapters"}</span>
      </button>`).join("");

    content().innerHTML = `<div class="view-enter">
      <div class="breadcrumbs">
        <a href="#/">Home</a><span class="material-symbols-rounded crumb-sep">chevron_right</span>
        <span class="current">Manga</span>
      </div>
      <div class="toolbar-row">
        <span class="count-label">${items.length} serie${items.length === 1 ? "" : "s"}</span>
        <div class="spacer"></div>
        <button class="outlined-btn" id="mangaUploadBtn"><span class="material-symbols-rounded">upload</span>Upload CBZ</button>
        <button class="tonal-btn" id="mangaNewFolder"><span class="material-symbols-rounded">create_new_folder</span>New series</button>
      </div>
      ${items.length ? `<div class="manga-grid">${cards}</div>` : `<div class="empty-state">
        <span class="material-symbols-rounded">menu_book</span>
        <h4>No manga yet</h4>
        <p>Drop <b>.cbz</b> archives (or folders of images) into <b>library/Manga</b>.</p>
        <button class="filled-btn" id="mangaEmptyUpload" style="margin-top:10px"><span class="material-symbols-rounded">upload</span>Upload CBZ</button>
      </div>`}
    </div>`;

    const map = new Map(items.map(i => [i.path, i]));
    const grid = qs(".manga-grid", content());
    if (grid) {
      markLoaded(grid);
      grid.addEventListener("click", e => {
        const coverBtn = e.target.closest("[data-cover]");
        if (coverBtn) {
          e.stopPropagation();
          coverMenu(coverBtn, map.get(coverBtn.dataset.cover));
          return;
        }
        const card = e.target.closest("[data-series]");
        if (!card) return;
        const it = map.get(card.dataset.series);
        if (!it) return;
        if (it.chapters.length === 1) navigate("#/manga/" + encPath(it.chapters[0].path));
        else chapterDialog(it);
      });
    }
    qs("#mangaUploadBtn")?.addEventListener("click", () => qs("#uploadBtn").click());
    qs("#mangaEmptyUpload")?.addEventListener("click", () => qs("#uploadBtn").click());
    qs("#mangaNewFolder")?.addEventListener("click", async () => {
      const name = await promptDialog("New series", { label: "Series name", value: "", ok: "Create" });
      if (!name) return;
      try { await api.post("/api/mkdir", { path: "Manga", name }); toast("Series folder created"); renderMangaLibrary(); }
      catch (err) { toast(err.message || "Could not create folder", { icon: "error" }); }
    });
  }

  function chapterDialog(it) {
    const { close } = openDialog(`
      <h3>${esc(it.name)}</h3>
      <div class="dlg-body">${it.chapters.length} chapters</div>
      <div class="chapter-list">${it.chapters.map((c, i) => `
        <button class="chapter-row" data-ch="${i}">
          <span class="material-symbols-rounded">auto_stories</span>
          <span class="ch-name">${esc(c.name)}</span>
          <span class="ch-pages">${c.pages || "?"} pages</span>
        </button>`).join("")}</div>
      <div class="dlg-actions"><button class="text-btn" data-act="cancel">Close</button></div>`, {
      onMount(dlg, close) {
        qsa("[data-ch]", dlg).forEach(b => b.onclick = () => {
          close();
          navigate("#/manga/" + encPath(it.chapters[+b.dataset.ch].path));
        });
        qs('[data-act="cancel"]', dlg).onclick = close;
      },
    });
  }

  function coverMenu(anchor, it) {
    if (!it) return;
    const items = [
      { icon: "image", label: "Change cover…", onClick: () => coverDialog(it) },
      { icon: "zoom_in", label: "Adjust cover…", onClick: () => coverDialog(it, { fromCurrent: true }) },
    ];
    if (it.customCover) items.push(
      { icon: "refresh", label: "Use first page (reset)", onClick: async () => {
          try {
            await api.del("/api/manga/cover?path=" + encodeURIComponent(it.path));
            toast("Cover reset to first page");
            renderMangaLibrary();
          } catch (err) { toast(err.message || "Could not reset cover", { icon: "error" }); }
        } },
    );
    menu(anchor, items);
  }

  /** Cover editor: pick an image (or the current cover), zoom & pan, then upload. */
  function coverDialog(it, { fromCurrent = false } = {}) {
    const srcUrl = `/api/manga/cover?path=${encodeURIComponent(it.path)}&v=${it.coverMtime || 0}`;
    let img = null, zoom = 1, ox = 0, oy = 0, fileName = "";
    const FW = 168, FH = 252;  // preview frame
    const OUT_W = 420, OUT_H = 630;

    const { close } = openDialog(`
      <h3>Cover — ${esc(it.name)}</h3>
      <div class="cover-preview" id="coverPrev">
        ${fromCurrent ? "" : `<span class="material-symbols-rounded">image</span>`}
        <img id="coverImg" alt="" ${fromCurrent ? `src="${srcUrl}"` : ""} style="display:${fromCurrent ? "block" : "none"}">
      </div>
      <div class="cover-zoom-row">
        <span class="material-symbols-rounded">zoom_out</span>
        <input type="range" id="coverZoom" min="1" max="3" step="0.01" value="1" aria-label="Zoom">
        <span class="material-symbols-rounded">zoom_in</span>
      </div>
      <div class="cover-src-name" id="coverName">${fromCurrent ? esc(it.name) : "No image chosen"}</div>
      <div class="dlg-actions">
        <button class="text-btn" data-act="pick">Choose image…</button>
        <button class="text-btn" data-act="cancel">Cancel</button>
        <button class="filled-btn" data-act="ok" ${fromCurrent ? "" : "disabled style=opacity:.5"}>Set cover</button>
      </div>`, {
      onMount(dlg, close) {
        const prev = qs("#coverPrev", dlg), imgEl = qs("#coverImg", dlg);
        const zoomEl = qs("#coverZoom", dlg), nameEl = qs("#coverName", dlg);
        const okBtn = qs('[data-act="ok"]', dlg);

        const layout = () => {
          if (!img || !img.naturalWidth) return;
          // cover-fit then apply zoom & pan, clamped so no gaps appear
          const fit = Math.max(FW / img.naturalWidth, FH / img.naturalHeight);
          const s = fit * zoom;
          const w = img.naturalWidth * s, h = img.naturalHeight * s;
          const maxX = Math.max(0, (w - FW) / 2), maxY = Math.max(0, (h - FH) / 2);
          ox = Math.max(-maxX, Math.min(maxX, ox));
          oy = Math.max(-maxY, Math.min(maxY, oy));
          imgEl.style.width = w + "px"; imgEl.style.height = h + "px";
          imgEl.style.left = (FW - w) / 2 + ox + "px";
          imgEl.style.top = (FH - h) / 2 + oy + "px";
        };
        const setImg = (src, name) => {
          imgEl.onerror = () => { img = null; toast("Could not read that image", { icon: "error" }); };
          imgEl.onload = () => { img = imgEl; zoom = 1; ox = oy = 0; zoomEl.value = "1"; layout(); };
          imgEl.src = src;
          imgEl.style.display = "block";
          prev.querySelector(":scope > .material-symbols-rounded")?.remove();
          fileName = name; nameEl.textContent = name;
          okBtn.disabled = false; okBtn.style.opacity = 1;
        };
        if (fromCurrent) {
          imgEl.onload = () => { img = imgEl; layout(); };
        }

        qs('[data-act="pick"]', dlg).onclick = () => {
          const inp = document.createElement("input");
          inp.type = "file"; inp.accept = "image/*";
          inp.onchange = () => {
            const f = inp.files[0];
            if (f) setImg(URL.createObjectURL(f), f.name);
          };
          inp.click();
        };
        zoomEl.oninput = () => { zoom = parseFloat(zoomEl.value); layout(); };

        // drag to pan
        let drag = null;
        prev.addEventListener("pointerdown", e => {
          if (!img) return;
          drag = { x: e.clientX - ox, y: e.clientY - oy };
          prev.setPointerCapture(e.pointerId);
          prev.style.cursor = "grabbing";
        });
        prev.addEventListener("pointermove", e => {
          if (!drag) return;
          ox = e.clientX - drag.x; oy = e.clientY - drag.y; layout();
        });
        prev.addEventListener("pointerup", () => { drag = null; prev.style.cursor = ""; });

        qs('[data-act="cancel"]', dlg).onclick = close;
        okBtn.onclick = () => {
          if (!img || !img.naturalWidth) return;
          const canvas = document.createElement("canvas");
          canvas.width = OUT_W; canvas.height = OUT_H;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#111"; ctx.fillRect(0, 0, OUT_W, OUT_H);
          const k = OUT_W / FW;
          const fit = Math.max(FW / img.naturalWidth, FH / img.naturalHeight);
          const s = fit * zoom * k;
          const w = img.naturalWidth * s, h = img.naturalHeight * s;
          ctx.drawImage(img, (OUT_W - w) / 2 + ox * k, (OUT_H - h) / 2 + oy * k, w, h);
          canvas.toBlob(async blob => {
            if (!blob) { toast("Could not encode cover", { icon: "error" }); return; }
            const fd = new FormData();
            fd.append("path", it.path);
            fd.append("file", blob, "cover.jpg");
            try {
              const r = await fetch("/api/manga/cover", { method: "POST", body: fd });
              if (!r.ok) throw new Error(`Upload failed (${r.status})`);
              toast("Cover updated");
              close();
              renderMangaLibrary();
            } catch (err) { toast(err.message || "Could not save cover", { icon: "error" }); }
          }, "image/jpeg", 0.88);
        };
      },
    });
  }

  return {
    renderHome, renderBrowse, renderSearch, renderVideo, renderDoc,
    openImageViewer, closeOverlays, refresh, itemMenu, renderMangaLibrary,
  };
})();
