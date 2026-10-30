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
    if (item.thumbnail) return item.thumbnail + ".jpg";
    if (item.still) return item.still + ".jpg";
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
    state.results.forEach(function (item) {
      box.appendChild(makeCard(item, openVideo));
    });

    $("empty").hidden = state.results.length > 0;
    var more = $("btn-more");
    more.hidden = state.results.length === 0 ||
      (state.totalHits > 0 && state.results.length >= state.totalHits);
    more.disabled = state.loading;
    more.textContent = state.loading ? "Betöltés…" : "További találatok";
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

  function runSearch(reset) {
    var input = $("search-input");
    var q = (input.value || "").trim();

    if (reset) {
      if (!q) return;
      state.query = q;
      state.nextPage = 1;
      state.results = [];
      state.totalHits = 0;
      $("results").innerHTML = "";
    }
    if (state.loading) return;

    if (!state.api) {
      setBanner("Az OpenAPI még nem áll készen. Ha ez az üzenet marad, " +
        "valószínűleg nem töltődött be a videa.hu scriptje (hálózat, blokkoló).");
      return;
    }

    var page = reset ? 1 : state.nextPage;
    state.loading = true;
    if (!reset) { $("btn-more").textContent = "Betöltés…"; $("btn-more").disabled = true; }
    clearBanner();

    state.api.searchVideos(state.query, page).then(function (res) {
      var vids = (res && res.videos) || [];
      state.totalHits = res && res.totalhits != null ? Number(res.totalhits) : vids.length;
      state.results = uniqueByVcode(state.results.concat(vids));
      state.nextPage = page + 1;
      state.loading = false;
      renderResults();
      log("search ok", state.query, "page", page, "hits", state.totalHits, "got", vids.length);
    }, function (err) {
      state.loading = false;
      state.lastError = (err && err.message) ? err.message : String(err);
      renderResults();
      setBanner(describeError(err));
      log("search hiba", state.lastError);
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

  function ensurePlayer(vcode) {
    if (typeof window.VIDEA === "undefined" || !state.playerApiLoaded) {
      state.pendingVideo = vcode;
      setBanner("A lejátszó (PlayerAPI) még töltődik…", "ok");
      return;
    }

    if (!state.player) {
      if (!$("player-slot")) return;
      try {
        state.player = new window.VIDEA.VideaPlayer({
          divToLoad: "player-slot",
          width: "480",
          height: "270",
          videoId: vcode,
          events: {
            onReady: onPlayerReady,
            onKeyError: onPlayerKeyError
          }
        });
        log("player létrehozva", vcode);
      } catch (e) {
        setBanner("A lejátszó nem indult el: " + e.message);
        log("player hiba", e.message);
      }
      return;
    }

    if (state.playerReady) {
      setBanner("");
      try {
        state.player.loadAndStartVideo(vcode);
        log("loadAndStartVideo", vcode);
      } catch (e) {
        log("load hiba", e.message);
      }
    } else {
      state.pendingVideo = vcode;
    }
  }

  function onPlayerReady() {
    state.playerReady = true;
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
    $("btn-back").addEventListener("click", function () { go("search"); });
    $("btn-fav").addEventListener("click", toggleFavorite);
    $("btn-reload").addEventListener("click", function () { location.reload(); });

    $("btn-open-web").addEventListener("click", function () {
      var url = "";
      try { url = (state.player && state.player.getVideoUrl()) || ""; } catch (e) { /* ignore */ }
      if (!url && state.current) url = "https://videa.hu/player?v=" + state.current.vcode;
      window.open(url, "_blank", "noopener");
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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
