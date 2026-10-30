# Videa mobil app – prototípus

Egyoldalas webbapp, ami a Videa **OpenAPI**-ját (keresés, listák) és a **PlayerAPI**-t
(lejátszó vezérlése) használja. Nincs build lépés: három fájl, bármelyik statikus
tárhelyre felmásolható.

```
videa-app/
├─ index.html        az app (ebben van a két API kulcs is)
├─ app.js            logika: keresés, lejátszó, kedvencek, előzmények
├─ search.js         szabadszavas keresés a videa.hu-n (proxyval)
├─ styles.css        mobilra tervezett sötét felület
├─ manifest.json     PWA: név, ikonok, teljes képernyős indítás
├─ sw.js             service worker (offline váz)
├─ icon-*.png        app ikonok
├─ diagnosztika.html önálló tesztoldal: működik-e a kulcs erről a címről?
├─ proxy/            a kereséshez szükséges serverless proxy (Cloudflare / Vercel)
└─ README.md
```

## Telepítés telefonra (PWA – „app" a kezdőképernyőn)

Az oldal már tartalmazza, ami ehhez kell (`manifest.json`, service worker, ikonok).
Telefonon:

1. Nyisd meg Chrome-ban: `https://videa-app.vercel.app/`
2. Menü (⋮) → **„Alkalmazás telepítése"** vagy **„Hozzáadás a kezdőképernyőhöz"**
3. Utána saját ikonnal indítható, **böngészősáv nélkül**, teljes képernyőn.

Ha ez megvan, a telefonon úgy viselkedik, mint egy app. Az igazi APK ehhez képest
csak annyi pluszt ad, hogy a Play Store-ból telepíthető – a működés ugyanez.

## Egy Videa-könyvtárhiba, amit meg kellett kerülni

A PlayerAPI `divToLoad` módja **elhasal, ha a lejátszót nem a script betöltésekor,
hanem később (pl. kattintásra) hozod létre**:

```
Uncaught TypeError: Cannot read properties of null (reading 'src')
```

Oka: a könyvtár a lejátszó létrehozásakor `document.currentScript.src`-re hivatkozik,
ami csak a script futása közben nem `null`. Megoldás: az iframe-et magunk készítjük el
(`https://videa.hu/player?v=<VCODE>&enableJsApi=1&apiKey=<KULCS>`), és a könyvtárat
`iframeID` móddal használjuk – ez nem érinti a `currentScript`-et.

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

## Android APK („filmezz")

Az `android/` mappa egy natív **WebView-tokot** tartalmaz: saját ikon (FlashTV – Play),
saját név („filmezz"), vissza gomb, teljes képernyős videó. A tartalmat a
`https://videa-app.vercel.app/` oldalról tölti, ezért a webes javítások
**újratelepítés nélkül** megjelennek benne.

A build **GitHub Actions-szel** fut, tehát nem kell Android Studio vagy SDK a gépre:

1. A workflow minden `android/**` módosításnál lefut (`.github/workflows/android.yml`).
2. A kész APK a **Releases** alatt jelenik meg, `apk-latest` címmel:
   `https://github.com/MyRoN85/videa-app/releases/download/apk-latest/app-debug.apk`
3. Telefonon: engedélyezd az ismeretlen forrásból telepítést, majd nyisd meg az APK-t.

Technikai adatok: `hu.filmezz.app`, minSdk 24 (Android 7), targetSdk 34, függőség nélküli
(AndroidX nélküli) build – így gyors és kevés helyen tud elromlani.

### Helyi build (opcionális)

Ha a gépen van Android SDK és JDK 17/21, az APK helyben is megépíthető:

```powershell
$env:JAVA_HOME      = "<jdk-17-vagy-21>"
$env:ANDROID_HOME   = "$env:LOCALAPPDATA\Android\Sdk"
$env:GRADLE_USER_HOME = "<a projekt melletti mappa>"
cd android
gradle assembleDebug
```

Az eredmény: `android/app/build/outputs/apk/debug/app-debug.apk`.

A debug kulcstár a projektben van (`android/keystore/debug.keystore`, jelszó: `android`),
így a build akkor is működik, ha a felhasználói profil nem írható, és a frissítések
**ugyanazzal az aláírással** települnek egymásra.

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
