/*
 * Találatok rendezése sorozatokhoz.
 *
 * Cél: ha egy sorozatra keresel (pl. "stranger things"), a részek
 * S01E01, S01E02… sorrendben jöjjenek – de a keresés relevanciája ne
 * sérüljön (tehát ne keveredjenek felülre teljesen más videók).
 *
 * Módszer: a találatokat "sorozat-csoportokba" rakjuk (a cím elejéből,
 * számok és epizód-jelölők nélkül). A csoportok a keresésben elfoglalt
 * első helyük szerint követik egymást, a csoporton belül pedig az
 * évad/rész számok döntenek.
 */
(function (root) {
  "use strict";

  function key(s) {
    return String(s || "").toLowerCase()
      .replace(/[áàâä]/g, "a").replace(/[éèêë]/g, "e").replace(/[íìîï]/g, "i")
      .replace(/[óòôöő]/g, "o").replace(/[úùûüű]/g, "u").replace(/ç/g, "c");
  }

  /* [évad, rész] vagy null. */
  function episode(title) {
    var t = String(title || "");
    var m;

    // "1. évad 5. rész" / "1. évad 5. fejezet"
    m = /(\d{1,2})\s*\.\s*évad[^0-9]{0,14}(\d{1,4})\s*\.\s*(?:rész|resz|fejezet)/i.exec(t);
    if (!m) m = /(\d{1,2})\s*\.\s*évad[^0-9]{0,14}(\d{1,4})/i.exec(t);
    if (m) return [parseInt(m[1], 10) || 0, parseInt(m[2], 10) || 0];

    // "S2 E021", "S01E01", "S2-E3"
    m = /\bS\s*(\d{1,2})\s*[\s\-_.]*E\s*(\d{1,4})\b/i.exec(t);
    if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];

    // "2x05"
    m = /\b(\d{1,2})\s*x\s*(\d{1,4})\b/i.exec(t);
    if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];

    // "Ep01", "Episode 5"
    m = /\b(?:ep|episode)\.?\s*(\d{1,4})\b/i.exec(t);
    if (m) return [0, parseInt(m[1], 10)];

    // "5. rész"
    m = /(\d{1,4})\s*\.\s*(?:rész|resz)\b/i.exec(t);
    if (m) return [0, parseInt(m[1], 10)];

    return null;
  }

  /* A sorozat "azonosítója": a cím első pár szava, számok és jelölők nélkül. */
  function series(title) {
    return key(title)
      .replace(/\b(?:s|e|ep|episode|resz|évad|evad|fejezet)\b/g, " ")
      .replace(/[0-9]+/g, " ")
      .replace(/[^a-z ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .slice(0, 2)
      .join(" ");
  }

  function durationSeconds(d) {
    var parts = String(d || "").trim().split(":");
    var s = 0;
    for (var i = 0; i < parts.length; i++) {
      var n = parseInt(parts[i].replace(/\D/g, ""), 10);
      if (isNaN(n)) return 0;
      s = s * 60 + n;
    }
    return s;
  }

  function medianOf(nums) {
    if (!nums.length) return 0;
    var a = nums.slice().sort(function (x, y) { return x - y; });
    var mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  /* Rövid (junk) videók kiszűrése.

     A jellemző hosszt a HOSSZÚ videókból (5 perc felett) számoljuk mediánként,
     különben a sok 2 másodperces szemét lehúzná a mediánt, és semmit nem
     szűrne.

     Küszöb = a jellemző hossz fele, de legfeljebb 30 perc és legalább 10 perc.
     Így egy 45 perces részekből álló sorozatnál a 30 perces rész is megjelenik,
     a 2 perces előzetes viszont nem.
     Rövid tartalmak keresésénél (pl. "trailer") csak a 15 másodpercesnél
     rövidebbeket dobjuk. */
  /* Előzetes / klip / részlet – ezek nem teljes filmek vagy részek. */
  var TRAILER_RE = /(előzetes|elozetes|trailer|teaser|részlet|reszlet|klip|clip|behind the scenes|kulissza|interjú|interju|promo\b)/i;

  function isTrailer(title) {
    return TRAILER_RE.test(String(title || ""));
  }

  function filterShorts(list, hide) {
    if (!hide) return { list: list, hidden: 0, threshold: 0 };

    var all = [];
    var longs = [];
    list.forEach(function (it) {
      var s = durationSeconds(it.duration);
      if (s > 0) {
        all.push(s);
        if (s >= 300) longs.push(s);
      }
    });

    var base = longs.length >= 3 ? medianOf(longs) : medianOf(all);
    if (!base) return { list: list, hidden: 0, threshold: 0 };

    var threshold;
    if (base < 900) {
      threshold = 15;                        // rövid tartalom: csak a törmelék
    } else {
      threshold = Math.min(30 * 60, Math.max(10 * 60, base / 2));
    }

    // Ha a találatok többsége előzetes, akkor épp azt keresi valaki –
    // olyankor nem szűrünk cím alapján.
    var trailerCount = 0;
    list.forEach(function (it) { if (isTrailer(it.title)) trailerCount++; });
    var dropTrailers = trailerCount <= Math.max(2, list.length * 0.6);

    var hidden = 0;
    var kept = [];

    list.forEach(function (it) {
      if (dropTrailers && isTrailer(it.title)) { hidden++; return; }
      var s = durationSeconds(it.duration);
      if (s > 0 && s < threshold) { hidden++; return; }
      kept.push(it);
    });

    return { list: kept, hidden: hidden, threshold: threshold };
  }

  function sortResults(list) {
    var order = {};
    var next = 0;

    var rows = list.map(function (item, index) {
      var group = series(item.title);
      if (!(group in order)) order[group] = next++;
      return { item: item, index: index, group: order[group], ep: episode(item.title) };
    });

    rows.sort(function (a, b) {
      if (a.group !== b.group) return a.group - b.group;

      // a csoporton belül előre azok, amelyeknél felismerhető az évad/rész
      var ae = a.ep ? 0 : 1;
      var be = b.ep ? 0 : 1;
      if (ae !== be) return ae - be;

      if (a.ep && b.ep) {
        if (a.ep[0] !== b.ep[0]) return a.ep[0] - b.ep[0];
        if (a.ep[1] !== b.ep[1]) return a.ep[1] - b.ep[1];
      }

      // egyébként marad a keresés eredeti sorrendje
      return a.index - b.index;
    });

    return rows.map(function (r) { return r.item; });
  }

  root.VideaSort = {
    sortResults: sortResults,
    filterShorts: filterShorts,
    durationSeconds: durationSeconds,
    episode: episode,
    series: series
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.VideaSort;
})(typeof window !== "undefined" ? window : globalThis);
