/* ==========================================================================
   Shelf — persistent music player with queue
   ========================================================================== */

"use strict";

const Player = (() => {
  const audio = new Audio();
  audio.preload = "auto";

  let queue = [];        // array of items {name, path}
  let order = [];        // queue indexes in play order (shuffled or sequential)
  let pos = -1;          // pointer into `order`
  let shuffle = false;
  let repeat = 0;        // 0 off, 1 all, 2 one
  let dragging = false;

  const $ = id => document.getElementById(id);
  const bar = () => $("playerBar");

  /* ---------- metadata parsing ("01 - Title.mp3" / "Artist - Title.mp3") ---------- */

  function parseMeta(name) {
    let base = name.replace(/\.[a-z0-9]+$/i, "");
    const out = { title: base, artist: "" };
    let m = base.match(/^\s*\d{1,3}\s*[-–.]\s*(.+)$/);
    if (m) base = m[1];
    m = base.match(/^(.+?)\s+[-–]\s+(.+)$/);
    if (m) { out.artist = m[1].trim(); out.title = m[2].trim(); }
    return out;
  }

  const currentItem = () => (pos >= 0 && pos < order.length ? queue[order[pos]] : null);

  /* ---------- rendering ---------- */

  function fillRange(input, pct) {
    input.style.setProperty("--fill", (pct * 100).toFixed(2) + "%");
  }

  function updateMediaSession(item, meta) {
    if (!("mediaSession" in navigator) || !item) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: meta.title,
        artist: meta.artist || "Unknown artist",
        album: "Shelf",
        artwork: [
          { src: location.origin + thumbUrl(item.path), sizes: "512x512", type: "image/jpeg" },
        ],
      });
    } catch {}
  }

  function renderNowPlaying() {
    const item = currentItem();
    if (!item) return;
    const meta = parseMeta(item.name);
    $("pbTitle").textContent = meta.title;
    $("pbArtist").innerHTML = (meta.artist ? esc(meta.artist) : "Unknown artist") +
      (audio.paused ? "" : ` <span class="pb-anim"><i></i><i></i><i></i></span>`);
    const art = $("pbArt"), fb = $("pbArtFallback");
    art.src = thumbUrl(item.path);
    art.onload = () => { art.hidden = false; fb.style.display = "none"; };
    art.onerror = () => { art.hidden = true; fb.style.display = "grid"; };
    updateMediaSession(item, meta);
    document.title = `${meta.title} — Shelf`;
  }

  function renderQueue() {
    const list = $("qdList");
    if (!queue.length) {
      list.innerHTML = `<div class="qd-empty">Queue is empty.<br>Add songs from your Music folder.</div>`;
      return;
    }
    list.innerHTML = "";
    queue.forEach((item, i) => {
      const meta = parseMeta(item.name);
      const row = el(`<button class="row-item ${order[pos] === i ? "playing" : ""}" data-q="${i}">
        <span class="row-thumb"><span class="material-symbols-rounded">${order[pos] === i ? "graphic_eq" : "music_note"}</span></span>
        <span class="row-info">
          <span class="row-name">${esc(meta.title)}</span>
          <span class="row-sub">${esc(meta.artist || item.path)}</span>
        </span>
        <span class="icon-btn small" data-remove="${i}" title="Remove"><span class="material-symbols-rounded">close</span></span>
      </button>`);
      row.onclick = e => {
        if (e.target.closest("[data-remove]")) {
          removeAt(i);
          return;
        }
        pos = order.indexOf(i);
        playCurrent();
      };
      list.appendChild(row);
    });
  }

  function syncRows() {
    const item = currentItem();
    qsa(".row-item[data-path]").forEach(r =>
      r.classList.toggle("playing", !!item && r.dataset.path === item.path && !audio.paused));
  }

  /* ---------- playback ---------- */

  function playCurrent() {
    const item = currentItem();
    if (!item) return;
    bar().hidden = false;
    audio.src = mediaUrl(item.path);
    audio.play().catch(() => toast("Can't play this file", { icon: "error" }));
    renderNowPlaying();
    renderQueue();
    syncRows();
  }

  function setQueue(items, startIndex = 0) {
    queue = items.slice();
    order = queue.map((_, i) => i);
    pos = Math.max(0, Math.min(startIndex, queue.length - 1));
    if (shuffle) {
      // keep the chosen track first, shuffle the rest around it
      const rest = order.filter(i => i !== pos);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      order = [pos, ...rest];
      pos = 0;
    }
    playCurrent();
  }

  function enqueue(items, playNext = false) {
    if (!queue.length) { setQueue(items, 0); return; }
    const base = queue.length;
    queue.push(...items);
    const newIdx = items.map((_, i) => base + i);
    if (playNext) order.splice(pos + 1, 0, ...newIdx);
    else order.push(...newIdx);
    renderQueue();
    toast(`Added ${items.length} to queue`, { icon: "queue_music" });
  }

  function removeAt(queueIdx) {
    const wasCurrent = currentItem() === queue[queueIdx];
    const orderPos = order.indexOf(queueIdx);
    order.splice(orderPos, 1);
    if (orderPos < pos) pos--;
    queue.splice(queueIdx, 1);
    // renumber order entries above the removed index
    order = order.map(v => (v > queueIdx ? v - 1 : v));
    if (wasCurrent) {
      if (pos >= order.length) pos = 0;
      if (queue.length) playCurrent();
      else { audio.pause(); bar().hidden = true; queue = []; pos = -1; }
    }
    renderQueue();
  }

  function togglePlay() {
    if (!queue.length) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else audio.pause();
  }

  function step(dir, auto = false) {
    if (!queue.length) return;
    if (repeat === 2 && auto) { audio.currentTime = 0; audio.play(); return; }
    let p = pos + dir;
    if (p >= order.length) {
      if (repeat === 1) p = 0;
      else { audio.pause(); audio.currentTime = 0; return; }
    }
    if (p < 0) p = repeat === 1 ? order.length - 1 : 0;
    pos = p;
    playCurrent();
  }

  function seekTo(sec) {
    if (isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(sec, audio.duration));
  }

  /* ---------- wiring ---------- */

  function setRangeFill(elSel, pct) { fillRange(qs(elSel), Math.max(0, Math.min(1, pct))); }

  function init() {
    const savedVol = parseFloat(localStorage.getItem("shelf.volume") ?? "1");
    audio.volume = isFinite(savedVol) ? savedVol : 1;
    $("pbVolume").value = audio.volume;
    setRangeFill("#pbVolume", audio.volume);

    $("pbPlay").onclick = togglePlay;
    $("pbPrev").onclick = () => step(-1);
    $("pbNext").onclick = () => step(1);
    $("pbShuffle").onclick = () => {
      shuffle = !shuffle;
      const cur = order[pos];
      order = queue.map((_, i) => i);
      if (shuffle) {
        const rest = order.filter(i => i !== cur);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        order = [cur, ...rest];
      }
      pos = order.indexOf(cur);
      $("pbShuffle").classList.toggle("on", shuffle);
      $("pbShuffle").querySelector(".material-symbols-rounded").style.fontVariationSettings =
        shuffle ? '"FILL" 1, "wght" 400, "GRAD" 0, "opsz" 24' : "";
      renderQueue();
    };
    $("pbRepeat").onclick = () => {
      repeat = (repeat + 1) % 3;
      const icon = $("pbRepeat").querySelector(".material-symbols-rounded");
      icon.textContent = repeat === 2 ? "repeat_on" : "repeat";
      $("pbRepeat").classList.toggle("on", repeat > 0);
      $("pbRepeat").title = ["Repeat: off", "Repeat: all", "Repeat: one"][repeat];
      if (repeat === 2) icon.textContent = "repeat_on";
    };

    /* seek interactions */
    const seek = $("pbSeek"), fill = $("pbSeekFill"), thumb = $("pbSeekThumb");
    const ratioFrom = e => {
      const r = seek.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    };
    seek.addEventListener("pointerdown", e => {
      if (!queue.length) return;
      dragging = true;
      seek.setPointerCapture(e.pointerId);
      seekTo(ratioFrom(e) * audio.duration);
    });
    seek.addEventListener("pointermove", e => { if (dragging) seekTo(ratioFrom(e) * audio.duration); });
    seek.addEventListener("pointerup", () => { dragging = false; });
    seek.addEventListener("keydown", e => {
      if (e.key === "ArrowRight") { seekTo(audio.currentTime + 5); e.preventDefault(); }
      if (e.key === "ArrowLeft") { seekTo(audio.currentTime - 5); e.preventDefault(); }
    });

    /* volume */
    const vol = $("pbVolume");
    vol.oninput = () => {
      audio.volume = parseFloat(vol.value);
      audio.muted = false;
      localStorage.setItem("shelf.volume", vol.value);
      setRangeFill("#pbVolume", parseFloat(vol.value));
      updateVolIcon();
    };
    $("pbMute").onclick = () => { audio.muted = !audio.muted; updateVolIcon(); };

    /* queue drawer */
    $("pbExpand").onclick = () => qs("#queueDrawer").classList.toggle("open");
    $("qdClose").onclick = () => qs("#queueDrawer").classList.remove("open");
    $("qdClear").onclick = () => {
      queue = []; order = []; pos = -1;
      audio.pause();
      bar().hidden = true;
      renderQueue();
      syncRows();
    };

    /* audio events */
    audio.addEventListener("play", () => {
      qs("#pbPlay .material-symbols-rounded").textContent = "pause";
      $("playerBar").classList.add("playing");
      renderNowPlaying();
      syncRows();
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    });
    audio.addEventListener("pause", () => {
      qs("#pbPlay .material-symbols-rounded").textContent = "play_arrow";
      $("playerBar").classList.remove("playing");
      renderNowPlaying();
      syncRows();
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
    });
    audio.addEventListener("timeupdate", () => {
      const pct = audio.duration ? audio.currentTime / audio.duration : 0;
      fill.style.width = (pct * 100).toFixed(2) + "%";
      thumb.style.left = (pct * 100).toFixed(2) + "%";
      $("pbCur").textContent = fmtTime(audio.currentTime);
      $("pbDur").textContent = fmtTime(audio.duration);
    });
    audio.addEventListener("ended", () => step(1, true));
    audio.addEventListener("error", () => {
      if (audio.src) toast("Can't play this file", { icon: "error" });
    });

    /* OS media keys */
    if ("mediaSession" in navigator) {
      const ms = navigator.mediaSession;
      const set = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
      set("play", () => audio.play());
      set("pause", () => audio.pause());
      set("previoustrack", () => step(-1));
      set("nexttrack", () => step(1));
      set("seekbackward", d => seekTo(audio.currentTime - (d?.seekOffset || 10)));
      set("seekforward", d => seekTo(audio.currentTime + (d?.seekOffset || 10)));
      set("seekto", d => { if (d?.seekTime != null) seekTo(d.seekTime); });
    }
  }

  function updateVolIcon() {
    const icon = qs("#pbMute .material-symbols-rounded");
    icon.textContent = audio.muted || audio.volume === 0 ? "volume_off"
      : audio.volume < 0.5 ? "volume_down" : "volume_up";
  }

  return {
    init, setQueue, enqueue, togglePlay, syncRows, renderQueue,
    isPlaying: () => !audio.paused && !!queue.length,
    currentItem,
  };
})();
