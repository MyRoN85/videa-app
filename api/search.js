/*
 * Vercel serverless függvény – CORS proxy a videa.hu keresőjéhez
 * ---------------------------------------------------------------
 * Ez a fájl a repó gyökerében lévő  api/search.js  legyen.
 * Telepítés (GitHub fiókkal, új jelszó nélkül):
 *   1. vercel.com → "Continue with GitHub" → engedélyezés
 *   2. "Add New…" → "Project" → importáld a videa-app repót → Deploy
 *   3. A cím: https://<projektnev>.vercel.app/api/search
 *   4. Ezt írd be a search.js-be:
 *        var PROXY_BASE = "https://<projektnev>.vercel.app/api/search?url=";
 */

const ALLOWED_ORIGIN = "https://myron85.github.io";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(204).end();

  const origin = req.headers.origin || "";
  if (origin && origin !== ALLOWED_ORIGIN) return res.status(403).send("forbidden origin");

  const target = String(req.query.url || "");
  if (!/^https:\/\/videa\.hu\//.test(target)) return res.status(400).send("bad target");

  try {
    const upstream = await fetch(target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "Accept-Language": "hu-HU,hu;q=0.9,en;q=0.8",
      },
    });

    const body = await upstream.text();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(upstream.status).send(body);
  } catch (e) {
    return res.status(502).send("proxy error: " + e.message);
  }
}
