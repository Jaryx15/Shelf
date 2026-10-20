/* ==========================================================================
   Shelf — boot: wire global controls and start the router
   ========================================================================== */

"use strict";

(() => {
  let lastBrowse = "#/";

  /* hash routing */
  window.addEventListener("hashchange", () => {
    const r = parseHash();
    if (r.name === "browse" || r.name === "home") lastBrowse = location.hash || "#/";
    const searchInput = qs("#searchInput");
    if (r.name === "search") {
      searchInput.value = r.q;
      qs("#searchClear").hidden = false;
    } else if (document.activeElement !== searchInput) {
      searchInput.value = "";
      qs("#searchClear").hidden = true;
    }
    route();
  });

  /* navigation drawer (mobile) */
  const drawer = qs("#drawer"), scrim = qs("#drawerScrim");
  const closeDrawer = () => { drawer.classList.remove("open"); scrim.classList.remove("open"); };
  qs("#menuBtn").onclick = () => {
    drawer.classList.toggle("open");
    scrim.classList.toggle("open", drawer.classList.contains("open"));
  };
  scrim.onclick = closeDrawer;
  qsa("#drawerNav .nav-item").forEach(a => a.addEventListener("click", closeDrawer));

  /* search */
  const searchInput = qs("#searchInput");
  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    qs("#searchClear").hidden = !q;
    searchTimer = setTimeout(() => {
      if (q) {
        if (parseHash().name !== "search" || parseHash().q !== q)
          location.hash = "#/search/" + encodeURIComponent(q);
        else route();
      } else if (parseHash().name === "search") {
        navigate(lastBrowse);
      }
    }, 300);
  });
  searchInput.addEventListener("keydown", e => {
    if (e.key === "Escape") { searchInput.value = ""; searchInput.dispatchEvent(new Event("input")); }
  });
  qs("#searchClear").onclick = () => {
    searchInput.value = "";
    searchInput.dispatchEvent(new Event("input"));
    searchInput.focus();
  };

  /* global shortcuts */
  document.addEventListener("keydown", e => {
    if (e.key === "/" && !e.target.matches("input, textarea")) {
      e.preventDefault();
      searchInput.focus();
    }
    if (e.key === "Escape") qs("#queueDrawer").classList.remove("open");
  });

  /* init subsystems */
  Player.init();
  wireTheme();
  wireUpload();
  refreshStorage();

  if (!location.hash) location.hash = "#/";
  else route();
})();
