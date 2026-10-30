/*
 * Videa – mobil webbapp prototípus
 * OpenAPI: keresés, listák  |  PlayerAPI: lejátszó vezérlése
 *
 * Fontos: ez a fájl csak akkor tud adatot kérni, ha az oldal olyan
 * origin-ről töltődik be, amit a Videa BEÁLLÍTÁSAIM alatt engedélyeztél.
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var DEBUG = [];
  function log() {
    DEBUG.push(Array.prototype.join.call(arguments, " "));
    if (DEBUG.length > 60) DEBUG.shift();
  }

  // ---------------------------------------------------------------- tárolás
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  var state = {
    api: null,
    playerApiLoaded: false,
    player: null,
    playerReady: false,
    playerKeyError: false,
    pendingVideo: null,
    current: null,
    query: "",
    nextPage: 1,
    totalHits: 0,
    hasMore: false,
    lastItemId: null,
    mode: "tag",
    sortMode: "episode",
    loading: false,
    results: [],
    favorites: load("videa.favorites", []),
    history: load("videa.history", []),
    pollTimer: null,
    lastError: null
  };

  // ------------------------------------------------------------- segédfüggvények
  function formatTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function thumbUrl(item) {
    if (!item) return "";
    // A Videa thumbnail URL-jei kiterjesztés nélkül is képet adnak,
    // a ".jpg" hozzáfűzése 404-et eredményez.
    if (item.thumbnail) return item.thumbnail;
    if (item.still) return item.still;
    return "";
  }

  function channelName(item) {
    if (!item) return "";
    if (item.channel && item.channel.name) return item.channel.name;
    return item.channelName || "";
  }

  function setBanner(message, kind) {
    var b = $("banner");
    if (!b) return;
    if (!message) {
      b.hidden = true;
      b.textContent = "";
      return;
    }
    b.hidden = false;
    b.textContent = message;
    b.className = "banner" + (kind === "ok" ? " ok" : "");
  }

  function clearBanner() { setBanner(""); }

  /* Látható hibakereső sor a lejátszó alatt – csak hiba esetén jelenik meg. */
  var pdebugLines = [];
  function showPdebug() {
    var el = $("pdebug");
    if (el) el.hidden = false;
  }
  function pdebug(msg) {
    pdebugLines.push(msg);
    if (pdebugLines.length > 6) pdebugLines.shift();
    var el = $("pdebug");
    if (el) el.textContent = pdebugLines.join("  |  ");
    log("DBG " + msg);
  }

  // A Videa lejátszó iframe üzeneteit figyeljük (a saját könyvtárunktól
  // függetlenül), hogy látszódjon, elindult-e egyáltalán a kézfogás.
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== "videaPlayerApiMessage") return;
    pdebug("msg:" + (e.data.event || "?") + " @" + Math.round(performance.now() / 1000) + "s");
  }, false);

  function describeError(err) {
    var msg = (err && err.message) ? err.message : String(err);
    if (/origin error/i.test(msg)) {
      return "A Videa nem engedélyezte ezt a webhelyet (" + location.origin +
        "). Jelentkezz be a videára, nyisd meg a BEÁLLÍTÁSAIM menüt, és add hozzá ezt a címet " +
        "mindkét API kulcshoz.";
    }
    if (/appId invalid/i.test(msg)) {
      return "Érvénytelen API kulcs, vagy nem webhelyről indult a kérés. " +
        "Ellenőrizd, hogy böngészőből, https:// címen nyitottad-e meg az oldalt.";
    }
    return "Hiba: " + msg;
  }

  // ------------------------------------------------------------------- nézetek
  function go(view) {
    ["search", "player", "lib", "info"].forEach(function (v) {
      var node = $("view-" + v);
      if (node) node.hidden = (v !== view);
    });

    var tabs = document.querySelectorAll(".tab");
    Array.prototype.forEach.call(tabs, function (t) {
      var isActive = t.getAttribute("data-view") === view ||
        (view === "player" && t.getAttribute("data-view") === "search");
      t.classList.toggle("active", isActive);
    });

    if (view === "lib") renderLibrary();
    if (view === "info") refreshInfo();

    if (view !== "player" && state.player && state.playerReady) {
      try { state.player.pauseVideo(); } catch (e) { log("pause hiba", e.message); }
    }

    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ keresés
  function makeCard(item, onOpen) {
    var card = document.createElement("button");
    card.type = "button";
    card.className = "card";

    var thumb = document.createElement("div");
    thumb.className = "card-thumb";

    var img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "";
    var url = thumbUrl(item);
    if (url) img.src = url;
    img.addEventListener("error", function () { img.style.visibility = "hidden"; });
    thumb.appendChild(img);

    if (item.duration) {
      var dur = document.createElement("span");
      dur.className = "dur";
      dur.textContent = item.duration;
      thumb.appendChild(dur);
    }

    var body = document.createElement("div");
    body.className = "card-body";

    var title = document.createElement("div");
    title.className = "card-title";
    title.textContent = item.title || "(cím nélkül)";

    var meta = document.createElement("div");
    meta.className = "card-meta";
    var bits = [];
    if (channelName(item)) bits.push(channelName(item));
    if (item.upload_date) bits.push(item.upload_date);
    meta.textContent = bits.join(" · ");

    body.appendChild(title);
    body.appendChild(meta);

    card.appendChild(thumb);
    card.appendChild(body);
    card.addEventListener("click", function () { onOpen(item); });

    return card;
  }

  function renderResults() {
    var box = $("results");
    box.innerHTML = "";

    var list = state.results.slice();
    if (state.sortMode !== "site") {
      list.sort(function (a, b) { return naturalCompare(a.title, b.title); });
    }

    list.forEach(function (item) {
      box.appendChild(makeCard(item, openVideo));
    });

    $("empty").hidden = state.results.length > 0;
    var more = $("btn-more");
    more.hidden = state.results.length === 0 || !state.hasMore;
    more.disabled = state.loading;
    more.textContent = state.loading ? "Betöltés…" : "További találatok";

    var sortbar = $("sortbar");
    if (sortbar) sortbar.hidden = state.results.length === 0;
  }

  function uniqueByVcode(list) {
    var seen = {};
    var out = [];
    list.forEach(function (v) {
      if (!v || !v.vcode) return;
      if (seen[v.vcode]) return;
      seen[v.vcode] = true;
      out.push(v);
    });
    return out;
  }

  /* Természetes rendezés: az "S2 E08" a "S2 E021" elé kerül, mert a számokat
     számként hasonlítja (a sima ábécé-sorrend az E021-et tenné előre). */
  function sortKey(s) {
    return String(s || "").toLowerCase()
      .replace(/[áàâä]/g, "a").replace(/[éèêë]/g, "e").replace(/[íìîï]/g, "i")
      .replace(/[óòôöő]/g, "o").replace(/[úùûüű]/g, "u").replace(/ç/g, "c");
  }

  function naturalCompare(a, b) {
    var ax = sortKey(a).match(/(\d+|\D+)/g) || [];
    var bx = sortKey(b).match(/(\d+|\D+)/g) || [];
    var n = Math.max(ax.length, bx.length);
    for (var i = 0; i < n; i++) {
      var av = ax[i], bv = bx[i];
      if (av === undefined) return -1;
      if (bv === undefined) return 1;
      var an = /^\d+$/.test(av), bn = /^\d+$/.test(bv);
      if (an && bn) {
        var d = parseInt(av, 10) - parseInt(bv, 10);
        if (d) return d;
      } else if (av !== bv) {
        return av < bv ? -1 : 1;
      }
    }
    return 0;
  }

  function searchMode() {
    return (window.VideaSearch && window.VideaSearch.hasProxy()) ? "search" : "tag";
  }

  function runSearch(reset) {
    var input = $("search-input");
    var q = (input.value || "").trim();

    if (reset) {
      if (!q) return;
      state.query = q;
      state.nextPage = 1;
      state.lastItemId = null;
      state.results = [];
      state.totalHits = 0;
      state.hasMore = false;
      state.loading = false;
      state.mode = searchMode();
      $("results").innerHTML = "";
    }
    if (state.loading) return;

    var reqId = (state.reqId = (state.reqId || 0) + 1);
    state.loading = true;
    $("btn-more").textContent = "Betöltés…";
    $("btn-more").disabled = true;
    clearBanner();

    if (state.mode === "search") runSiteSearch(reqId);
    else runTagSearch(reqId);
  }

  /* Valódi szabadszavas keresés a videa.hu saját keresőjén (proxy szükséges). */
  function runSiteSearch(reqId) {
    window.VideaSearch.search(state.query, state.lastItemId).then(function (res) {
      if (reqId !== state.reqId) return;
      state.results = uniqueByVcode(state.results.concat(res.items));
      state.lastItemId = res.lastItemId;
      state.hasMore = res.items.length > 0;
      state.loading = false;
      renderResults();
      log("site ok", state.query, "got", res.items.length);
    }, function (err) {
      if (reqId !== state.reqId) return;
      state.loading = false;
      state.lastError = (err && err.message) ? err.message : String(err);
      state.hasMore = false;
      renderResults();
      setBanner("A keresés nem sikerült: " + state.lastError +
        ". Ellenőrizd a proxyt (search.js → PROXY_BASE) és a hálózatot.");
      refreshInfo();
    });
  }

  /* Tartalék: a szabadszavas keresés halott az OpenAPI-ban, ezért címkére keresünk. */
  function runTagSearch(reqId) {
    if (!state.api) {
      state.loading = false;
      renderResults();
      setBanner("Az OpenAPI még nem áll készen. Ha ez az üzenet marad, " +
        "valószínűleg nem töltődött be a videa.hu scriptje (hálózat, blokkoló).");
      return;
    }

    var page = state.nextPage;
    var sort = "upload_date";

    state.api.getTagVideos(state.query, sort, page).then(function (res) {
      if (reqId !== state.reqId) return;
      var vids = (res && res.videos) || [];
      state.totalHits = res && res.totalhits != null ? Number(res.totalhits) : vids.length;
      state.results = uniqueByVcode(state.results.concat(vids));
      state.nextPage = page + 1;
      state.hasMore = vids.length > 0 && state.results.length < state.totalHits;
      state.loading = false;
      renderResults();
      log("tag ok", state.query, sort, "page", page, "hits", state.totalHits, "got", vids.length);
    }, function (err) {
      if (reqId !== state.reqId) return;
      state.loading = false;
      state.lastError = (err && err.message) ? err.message : String(err);
      state.hasMore = false;
      if (/invalid id param/i.test(state.lastError)) {
        setBanner("Nincs „" + state.query + "” nevű címke a Videán. Szabadszavas kereséshez " +
          "proxy kell (README → Keresés) – proxy nélkül csak címkére tudunk keresni.");
        renderResults();
        refreshInfo();
        return;
      }
      renderResults();
      setBanner(describeError(err));
      log("tag hiba", state.lastError);
      refreshInfo();
    });
  }

  // ------------------------------------------------------------------ lejátszó
  function openVideo(item) {
    if (!item || !item.vcode) return;

    state.current = {
      vcode: item.vcode,
      title: item.title || "",
      channelName: channelName(item),
      thumbnail: item.thumbnail || item.still || "",
      duration: item.duration || ""
    };

    $("np-title").textContent = state.current.title || "Videó";
    $("np-channel").textContent = state.current.channelName;
    $("np-time").textContent = "0:00";
    $("np-duration").textContent = state.current.duration || "0:00";
    $("np-progress-fill").style.width = "0%";
    $("np-state").textContent = "Betöltés…";

    addHistory(state.current);
    updateFavButton();
    go("player");
    ensurePlayer(item.vcode);
  }

  /* A PlayerAPI "divToLoad" módja elhasal, mert a könyvtár a lejátszó
     létrehozásakor document.currentScript.src-re hivatkozik – az viszont
     kattintásra már null. Ezért mi készítjük el az iframe-et, és az
     "iframeID" módot használjuk, ami nem érinti a currentScript-et. */
  function createPlayerFrame(vcode) {
    var wrap = document.querySelector(".player-wrap");
    if (!wrap) return null;

    var frame = document.createElement("iframe");
    frame.id = "videa-player-frame";
    frame.src = "https://videa.hu/player?v=" + encodeURIComponent(vcode) +
      "&enableJsApi=1&apiKey=" + encodeURIComponent((window.VIDEA_KEYS || {}).player || "");
    frame.setAttribute("frameborder", "0");
    frame.setAttribute("allowfullscreen", "allowfullscreen");
    frame.setAttribute("webkitallowfullscreen", "webkitallowfullscreen");
    frame.setAttribute("mozallowfullscreen", "mozallowfullscreen");
    frame.setAttribute("allow", "autoplay; fullscreen; encrypted-media; picture-in-picture");
    frame.addEventListener("load", function () { pdebug("iframe betöltve"); });
    pdebug("iframe indít");

    var slot = $("player-slot");
    if (slot && slot.parentNode === wrap) wrap.removeChild(slot);

    wrap.appendChild(frame);
    return frame;
  }

  /* A Videa lejátszó belső állapota (kiválasztott minőség, hibaállapot)
     átragadhat a következő videóra: egy hibás videó után a jók sem indulnak.
     Ezért minden videóhoz friss lejátszót készítünk. */
  function destroyPlayer() {
    if (state.player) {
      try { state.player.pauseVideo(); } catch (e) { /* ignore */ }
    }
    state.player = null;
    state.playerReady = false;

    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }

    var wrap = document.querySelector(".player-wrap");
    if (wrap) wrap.innerHTML = "";
  }

  function ensurePlayer(vcode) {
    if (typeof window.VIDEA === "undefined" || !state.playerApiLoaded) {
      state.pendingVideo = vcode;
      setBanner("A lejátszó (PlayerAPI) még töltődik…", "ok");
      return;
    }

    destroyPlayer();

    var resetBtn = $("btn-reset");
    if (resetBtn) resetBtn.hidden = true;
    var dbgEl = $("pdebug");
    if (dbgEl) dbgEl.hidden = true;

    var frame = createPlayerFrame(vcode);
    if (!frame) {
      setBanner("Nem találom a lejátszó helyét (.player-wrap).");
      return;
    }

    try {
      state.player = new window.VIDEA.VideaPlayer({
        iframeID: frame.id,
        events: {
          onReady: onPlayerReady,
          onKeyError: onPlayerKeyError
        }
      });
      log("player létrehozva", vcode);
      pdebug("objektum kész");

      var watchdogVideo = vcode;
      setTimeout(function () {
        if (state.current && state.current.vcode === watchdogVideo && !state.playerReady) {
          pdebug("nincs ready 10s után");
          showPdebug();
          setBanner("A lejátszó nem indult el. Nyomd meg az „Adatok törlése” gombot: " +
            "ez kitakarítja a Videa elakadt állapotát a készüléken.");
          var resetBtn = $("btn-reset");
          if (resetBtn) resetBtn.hidden = false;
        }
      }, 10000);
    } catch (e) {
      setBanner("A lejátszó nem indult el: " + e.message);
      log("player hiba", e.message);
    }
  }

  function onPlayerReady() {
    state.playerReady = true;
    pdebug("ready");
    clearBanner();

    if (state.pendingVideo) {
      var vcode = state.pendingVideo;
      state.pendingVideo = null;
      try { state.player.loadAndStartVideo(vcode); } catch (e) { log("pending load hiba", e.message); }
    } else {
      try { state.player.playVideo(); } catch (e) { log("play hiba", e.message); }
    }

    startPolling();
    refreshInfo();
  }

  function onPlayerKeyError() {
    state.playerKeyError = true;
    pdebug("kulcs/origin hiba");
    showPdebug();
    state.lastError = "player: " + describeError({ message: "origin error" });
    setBanner("A lejátszó elutasította az API kulcsot erről a címről (" + location.origin +
      "). Engedélyezd ezt a webhelyet a Videa BEÁLLÍTÁSAIM alatt, a PlayerAPI kulcshoz is.");
    refreshInfo();
  }

  function startPolling() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(updateHud, 700);
  }

  function updateHud() {
    var p = state.player;
    if (!p || !state.playerReady || !state.current) return;

    var t = 0, d = 0, playing = 0, title = "", channel = "";
    try { t = p.getCurrentTime() || 0; } catch (e) { /* ignore */ }
    try { d = p.getDuration() || 0; } catch (e) { /* ignore */ }
    try { playing = p.isPlaying(); } catch (e) { /* ignore */ }
    try { title = p.getVideoTitle() || ""; } catch (e) { /* ignore */ }

    if (title) {
      $("np-title").textContent = title;
      if (state.current) state.current.title = title;
    }

    $("np-time").textContent = formatTime(t);
    if (d > 0) $("np-duration").textContent = formatTime(d);
    $("np-state").textContent = playing ? "Lejátszás" : "Megállítva";

    var pct = d > 0 ? Math.min(100, (t / d) * 100) : 0;
    $("np-progress-fill").style.width = pct + "%";
  }

  function updateFavButton() {
    var btn = $("btn-fav");
    if (!btn || !state.current) return;
    var isFav = state.favorites.some(function (f) { return f.vcode === state.current.vcode; });
    btn.textContent = isFav ? "★ Kedvencekben" : "☆ Kedvencekhez";
    btn.classList.toggle("on", isFav);
  }

  function toggleFavorite() {
    if (!state.current) return;
    var idx = -1;
    state.favorites.forEach(function (f, i) {
      if (f.vcode === state.current.vcode) idx = i;
    });
    if (idx >= 0) {
      state.favorites.splice(idx, 1);
    } else {
      state.favorites.unshift(state.current);
    }
    save("videa.favorites", state.favorites);
    updateFavButton();
  }

  function addHistory(item) {
    state.history = state.history.filter(function (h) { return h.vcode !== item.vcode; });
    state.history.unshift(Object.assign({ ts: Date.now() }, item));
    state.history = state.history.slice(0, 30);
    save("videa.history", state.history);
  }

  // ------------------------------------------------------------------ könyvtár
  function renderLibrary() {
    var favBox = $("fav-list");
    var histBox = $("history-list");
    favBox.innerHTML = "";
    histBox.innerHTML = "";

    state.favorites.forEach(function (item) { favBox.appendChild(makeCard(item, openVideo)); });
    state.history.forEach(function (item) { histBox.appendChild(makeCard(item, openVideo)); });

    $("fav-empty").hidden = state.favorites.length > 0;
    $("history-empty").hidden = state.history.length > 0;
  }

  // ---------------------------------------------------------------------- infó
  function refreshInfo() {
    if (!$("info-origin")) return;

    $("origin-label").textContent = location.origin;
    $("info-origin").textContent = location.origin;

    var openState = $("info-open");
    if (state.api) {
      openState.textContent = "betöltve";
      openState.className = "ok";
    } else if (window.__videaOpenInitError) {
      openState.textContent = "hiba: " + window.__videaOpenInitError;
      openState.className = "bad";
    } else {
      openState.textContent = "még nem töltődött be";
      openState.className = "bad";
    }

    var playerState = $("info-player");
    if (state.playerKeyError) {
      playerState.textContent = "kulcs/origin hiba";
      playerState.className = "bad";
    } else if (state.playerApiLoaded) {
      playerState.textContent = state.playerReady ? "betöltve, kész" : "betöltve, lejátszó még nincs";
      playerState.className = "ok";
    } else {
      playerState.textContent = "még nem töltődött be";
      playerState.className = "bad";
    }

    $("info-error").textContent = state.lastError || "nincs";
  }

  // -------------------------------------------------------------------- indítás
  function wire() {
    $("search-form").addEventListener("submit", function (e) {
      e.preventDefault();
      runSearch(true);
    });

    $("btn-more").addEventListener("click", function () { runSearch(false); });

    $("sort-select").addEventListener("change", function () {
      state.sortMode = $("sort-select").value;
      renderResults();
    });

    $("btn-back").addEventListener("click", function () { go("search"); });
    $("btn-fav").addEventListener("click", toggleFavorite);

    $("btn-retry").addEventListener("click", function () {
      if (state.current) ensurePlayer(state.current.vcode);
    });
    $("btn-reload").addEventListener("click", function () { location.reload(); });

    $("btn-reset").addEventListener("click", function () {
      if (window.FilmezzNative && window.FilmezzNative.hardReset) {
        setBanner("Takarítás és újratöltés…", "ok");
        window.FilmezzNative.hardReset();
      } else {
        // Böngészőben nincs mély takarítás – csak újratöltünk
        location.reload();
      }
    });

    $("btn-open-web").addEventListener("click", function () {
      var url = "";
      try { url = (state.player && state.player.getVideoUrl()) || ""; } catch (e) { /* ignore */ }
      if (!url && state.current) url = "https://videa.hu/player?v=" + state.current.vcode;

      // Az appban minden külső navigáció blokkolva van, ezért itt kérjük
      // a natív rétegtől, hogy nyissa meg a rendszer böngészőjében.
      if (window.FilmezzNative && window.FilmezzNative.openExternal) {
        window.FilmezzNative.openExternal(url);
      } else {
        window.open(url, "_blank", "noopener");
      }
    });

    $("btn-clear-history").addEventListener("click", function () {
      state.history = [];
      save("videa.history", state.history);
      renderLibrary();
    });

    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (tab) {
      tab.addEventListener("click", function () { go(tab.getAttribute("data-view")); });
    });

    window.addEventListener("videa-openapi-ready", function () {
      if (window.videaApi) {
        state.api = window.videaApi;
        log("openapi kész");
        refreshInfo();
      }
    });

    window.addEventListener("videa-playerapi-ready", function () {
      state.playerApiLoaded = true;
      log("playerapi kész");
      refreshInfo();
      if (state.pendingVideo) {
        var v = state.pendingVideo;
        state.pendingVideo = null;
        ensurePlayer(v);
      }
    });

    if (window.videaApi) state.api = window.videaApi;

    // ha 8 másodperc alatt sem töltődött be az OpenAPI, jelezzük
    setTimeout(function () {
      if (!state.api) {
        setBanner("Az OpenAPI nem töltődött be 8 másodpercen belül. Ellenőrizd a hálózatot, " +
          "vagy hogy nem blokkolja-e valami a videa.hu scriptjét.");
      }
    }, 8000);

    refreshInfo();

    // PWA: ha támogatott, regisztráljuk a service workert (kitűzhető app).
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("sw.js").catch(function () { /* csendben */ });
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
