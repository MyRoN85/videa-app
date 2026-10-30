# Videa mobil app – prototípus

Egyoldalas webbapp, ami a Videa **OpenAPI**-ját (keresés, listák) és a **PlayerAPI**-t
(lejátszó vezérlése) használja. Nincs build lépés: három fájl, bármelyik statikus
tárhelyre felmásolható.

```
videa-app/
├─ index.html        az app (ebben van a két API kulcs is)
├─ app.js            logika: keresés, lejátszó, kedvencek, előzmények
├─ styles.css        mobilra tervezett sötét felület
├─ diagnosztika.html önálló tesztoldal: működik-e a kulcs erről a címről?
└─ README.md
```

## Miért kell hosztolni? (ezt nem lehet megúszni)

A Videa API-k nem mobil SDK-k, hanem böngészőben futó JavaScriptek, és a kulcsod
**egy webhelycímhez (origin) van kötve**. A szerver kizárólag az `Origin` fejléc alapján dönt:

| Kérés eredete | Válasz |
|---|---|
| nincs `Origin` (natív app, `file://`) | `appId invalid` |
| `http://localhost`, `capacitor://localhost`, `null` | `appId invalid` / `origin error` |
| ismeretlen `https://…` | `origin error` |
| **a fiókodban engedélyezett `https://…`** | működik |

Ezért az app belsejében egy **általad üzemeltetett HTTPS oldalnak** kell futnia.
A natív app (Capacitor) csak a keretet adja köré: ikon, splash, vissza gomb, értesítések.

## Első lépés: origin engedélyezése a Videán

1. Jelentkezz be a [videa.hu](https://videa.hu) oldalra.
2. Nyisd meg a **BEÁLLÍTÁSAIM** menüpontot, keresd az API kulcsokhoz tartozó űrlapot.
3. Add hozzá a webhelyed címét – **mindkét kulcshoz** (`AGYLdbkyMeWhPkF0` és `00mGAFYJo5Q8IrE3`).
   Csak a cím kell, pl. `https://felhasznalonev.github.io` (út nélkül).
4. Ha engedi a rendszer, vedd fel a `http://localhost:5173` címet is – akkor helyben is
   tudunk fejleszteni.

> Jelenleg a kulcsaidhoz **egyetlen webhely sincs engedélyezve**, ezért minden kérés
> `origin error`-t kap. Ezt kell először megoldani.

## Második lépés: az oldal felrakása

**A) GitHub Pages (ingyenes, 5 perc)**

1. Új repository, pl. `videa-app` (public).
2. Töltsd fel a 4 fájlt a repó gyökerébe (`index.html`, `app.js`, `styles.css`, `diagnosztika.html`).
3. Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)` → Save.
4. Pár perc múlva: `https://<felhasználó>.github.io/videa-app/`.
5. Az **origin**, amit a Videánál meg kell adni: `https://<felhasználó>.github.io`
   (a `/videa-app/` út nem számít bele).

**B) Cloudflare Pages / Netlify** – ugyanígy, drag & drop, szintén ingyenes.

**C) Saját domain + tárhely** – ha van, ez a legjobb (a `github.io`-t egyes
szolgáltatások idegen domainként kezelik).

## Harmadik lépés: tesztelés

1. Nyisd meg telefonon: `https://<a-te-címed>/diagnosztika.html`
2. Felül látod a pontos origint, ez alatt az OpenAPI keresés eredményét (zöld = siker).
3. A „Lejátszó betöltése” gombbal a PlayerAPI-t is kipróbálhatod.
4. Ha mindkettő zöld, nyisd meg az `index.html`-t – máris használható az app.

Ha a keresés `origin error`-t ad: az origin még nincs engedélyezve, vagy nem pontosan
egyezik (pl. `http` vs `https`, `www` előtag).

## Szabadszavas keresés bekapcsolása (kb. 5 perc)

Az app **kétféle keresést** tud:

| Mód | Mikor aktív | Mit tud |
|---|---|---|
| **Címke-keresés** (OpenAPI) | alapból | csak létező címkékre (zene, film, batman…) |
| **Valódi keresés** (videa.hu keresője) | ha `PROXY_BASE` be van állítva | bármilyen szóra, több szóra is: „Trónok harca” → 36 találat |

A valódi kereséshez azért kell proxy, mert a videa.hu keresőoldala nem küld CORS
fejlécet, így a böngésző nem olvashatja. Egy ingyenes serverless függvény 5 perc alatt
megoldja. Két kész változat van a `proxy/` mappában, a lépések a fájlok tetején:

- `proxy/cloudflare-worker.js` – Cloudflare Worker (email-es regisztráció)
- `proxy/vercel-api-search.js` – Vercel függvény (GitHub-fiókkal, új jelszó nélkül)

Utána a kapott címet írd be a `search.js` elejére:

```js
var PROXY_BASE = "https://videa-proxy.xyz.workers.dev/?url=";
```

és töltsd fel újra a `search.js`-t. Ha be van állítva, az app automatikusan
valódi keresésre vált. Ha üresen hagyod, a címke-keresés marad.

## Mit tud most az app

- Keresés (proxyval szabadszavas, proxy nélkül címkére), lapozással
- Lejátszó a Videa saját lejátszójával, cím és idő kijelzése
- Kedvencek és előzmények (localStorage-ban, a készüléken)
- Állapotoldal: origin, API-k, utolsó hiba

## Miért címke-keresés? (mért eredmény)

A 2017-es OpenAPI szabadszavas keresése (`searchVideos`) **már nem működik**: a `word`
paraméter helyes (a hibaüzenetek ezt megerősítik), de a szerver minden szóra
`totalhits: 0`-t ad. A többi végpont viszont él:

| Hívás | Állapot |
|---|---|
| `getTagVideos` | ✅ működik (`zene`, `film`, `magyar` → 1000 találat, `batman` → 295) |
| `getChannelVideos` | ✅ működik (pl. chid 2 → 973 videó) |
| `getVideoData` | ✅ működik (cím, leírás, címkék, csatorna, thumbnail, nézettség) |
| `searchVideos` | ❌ mindig 0 találat |
| `getProfileData`, `getUserVideos`, `getCategoryVideos` | ❌ „API method no longer supported” |

Ezért az app a beírt szót **címkeként** keresi. Ha nincs ilyen címke, a szerver
`invalid id param` hibát ad – ezt az appbarát módon kezeli.

Lapozás: az `offset` **oldalszám** (0-tól), a `hits` 10–50 között állítható.
A `totalhits` 1000-nél „megáll” (ennyi a szerver oldali plafon).

## Következő lépések (ha a fentiek zöldek)

1. **Capacitor váz**: `androidScheme`, splash, vissza gomb, fullscreen kezelés.
2. Fullscreen: Androidon `WebChromeClient.onShowCustomView` – ezt natívan kell megoldani.
3. Saját vezérlősáv (`disablePlayerUI` + saját gombok).
4. Címke/csatorna alapú kezdőképernyő, „következő videó” a lejátszó alatt.

## Fontos a kulcsokról

- A kulcsok kliensoldaliak: mivel a HTML-ben szerepelnek, aki megnyitja az oldalt, látja őket.
  Ez ezzel az API-val együtt jár. A kockázatot az origin-korlát csökkenti: idegen címről
  a kulcs `origin error`-t kap.
- A két kulcs **nem** ugyanaz, ne cseréld fel őket.
- Ha nyilvános repóba teszed, a kulcsok nyilvánosak lesznek. Ha ez zavar, használj
  privát tárhelyet, vagy egy „konfig” fájlt, ami nincs a repóban.
