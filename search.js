/*
 * Videa szabadszavas keresés a videa.hu saját keresőjén keresztül.
 *
 * Miért kell proxy? A videa.hu keresőoldala nem küld CORS fejlécet, ezért
 * böngészőből közvetlenül nem olvasható. Egy kis proxyn át viszont igen.
 *
 * Beállítás: írd be a PROXY_BASE változóba a proxy címét (lásd README).
 * Ha üres, az app a címke-keresésre (OpenAPI getTagVideos) esik vissza.
 */
(function (root) {
  "use strict";

  var PROXY_BASE = "";   // pl. "https://videa-proxy.myron85.workers.dev/?url="

  var LAZY = "https://videa.hu/lazy/kereses/";

  function decode(s) {
    return String(s == null ? "" : s)
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(Number(d)); })
      .replace(/&amp;/g, "&");
  }

  function first(re, s) {
    var m = re.exec(s);
    return m ? m[1] : "";
  }

  /* A találati lista HTML-jéből nyers videó-adatok.
     Egy kártya:
       <div class="col video-item">
         <div class="videa-search-list-item ..." data-item-id="VCODE">
           <div class="image-container ..." data-image="THUMB">
             <div class="length">01:18:37</div>
           </div>
           <div class="info-box">
             <h2 class="title"><a href="..." title="CÍM">CÍM</a></h2>
             <div class="uploader"><a href="/tagok/...">CSATORNA</a></div>
             <div class="other-infos">
               <div class="view-count">1261 views</div>
               <div class="uploaded-at">1 hónapja</div>
             </div>
           </div>
         </div>
       </div> */
  function parseItems(html) {
    var chunks = String(html || "").split('<div class="col video-item">');
    var out = [];

    for (var i = 1; i < chunks.length; i++) {
      var c = chunks[i];
      var vcode = first(/data-item-id="([A-Za-z0-9]{16})"/, c);
      if (!vcode) continue;

      var title = first(/<h2 class="title"><a[^>]*?title="([^"]*)"/, c);
      if (!title) title = first(/<h2 class="title"><a[^>]*>([^<]*)</, c);

      out.push({
        vcode: vcode,
        title: decode(title),
        thumbnail: decode(first(/data-image="([^"]+)"/, c)),
        duration: decode(first(/<div class="length">([^<]+)<\/div>/, c)),
        channelName: decode(first(/<div class="uploader">[\s\S]*?<a href="\/tagok\/[^"]*"\s*>([^<]+)<\/a>/, c)),
        views: decode(first(/<div class="view-count">([^<]*)<\/div>/, c)),
        uploadedAt: decode(first(/<div class="uploaded-at">([^<]*)<\/div>/, c))
      });
    }
    return out;
  }

  function buildUrl(word, lastItemId) {
    return LAZY + encodeURIComponent(word) +
      "?cacheId=" + encodeURIComponent(word) +
      "&lastItemId=" + encodeURIComponent(lastItemId || "0") +
      "&itemCount=30&sort=0";
  }

  function fetchText(url) {
    var target = PROXY_BASE ? PROXY_BASE + encodeURIComponent(url) : url;
    return fetch(target, { credentials: "omit", mode: "cors" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }

  function search(word, lastItemId) {
    return fetchText(buildUrl(word, lastItemId)).then(function (html) {
      var items = parseItems(html);
      return {
        items: items,
        lastItemId: items.length ? items[items.length - 1].vcode : null
      };
    });
  }

  root.VideaSearch = {
    hasProxy: function () { return !!PROXY_BASE; },
    setProxy: function (url) { PROXY_BASE = url || ""; },
    search: search,
    parseItems: parseItems,
    buildUrl: buildUrl
  };

  if (typeof module !== "undefined" && module.exports) module.exports = root.VideaSearch;
})(typeof window !== "undefined" ? window : globalThis);
