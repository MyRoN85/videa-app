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
      .slice(0, 4)
      .join(" ");
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

  root.VideaSort = { sortResults: sortResults, episode: episode, series: series };
  if (typeof module !== "undefined" && module.exports) module.exports = root.VideaSort;
})(typeof window !== "undefined" ? window : globalThis);
