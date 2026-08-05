/**
 * Serverless subtitle proxy.
 *
 * Keeps the SubDL API key (and TMDB key, for external_ids) off the
 * client. Two routes share the same function:
 *
 *   GET /api/subtitles/tmdb-external-ids?tmdbId=1399&mediaType=tv
 *     → { imdb_id: "tt0944947" }        (or null)
 *
 *   GET /api/subtitles/subdl?imdb_id=tt0944947&languages=sd_ar
 *     → SubDL JSON, passthrough
 *
 * Configure in `.env` (server-side — *not* VITE_*):
 *   SUBDL_API_KEY=...
 *   TMDB_API_KEY=...
 *
 * Set `VITE_SUBDL_PROXY_URL` on the client to point here.
 */

const TMDB_BASE = "https://api.themoviedb.org/3";
const SUBDL_BASE = "https://api.subdl.com/api/v1/subtitles";

const SUBDL_API_KEY = process.env.SUBDL_API_KEY ?? "";
const TMDB_API_KEY = process.env.TMDB_API_KEY ?? "";

/* ───────────────────────────  CORS  ─────────────────────────── */

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function applyCors(res: any) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);
}

/* ───────────────────────────  Route handlers  ─────────────────────────── */

async function handleTmdbExternalIds(req: any, res: any): Promise<void> {
  const tmdbId = Number(req.query?.tmdbId);
  const mediaType = String(req.query?.mediaType ?? "movie");
  if (!tmdbId || !["movie", "tv"].includes(mediaType)) {
    res.status(400).json({ error: "Bad tmdbId/mediaType" });
    return;
  }
  if (!TMDB_API_KEY) {
    res.status(500).json({ error: "TMDB_API_KEY not configured" });
    return;
  }

  const url = `${TMDB_BASE}/${mediaType}/${tmdbId}/external_ids?api_key=${encodeURIComponent(TMDB_API_KEY)}`;
  try {
    const r = await fetch(url);
    if (!r.ok) {
      res.status(r.status).json({ error: `TMDB ${r.status}` });
      return;
    }
    const data = (await r.json()) as { imdb_id?: string | null };
    res.status(200).json({ imdb_id: data?.imdb_id ?? null });
  } catch (e) {
    res.status(502).json({ error: "Upstream TMDB call failed" });
  }
}

async function handleSubdlLookup(req: any, res: any): Promise<void> {
  const imdbId = String(req.query?.imdb_id ?? "").trim();
  const languages = String(req.query?.languages ?? "sd_ar");
  if (!imdbId) {
    res.status(400).json({ error: "Missing imdb_id" });
    return;
  }
  if (!SUBDL_API_KEY) {
    res.status(500).json({ error: "SUBDL_API_KEY not configured" });
    return;
  }

  const params = new URLSearchParams({
    api_key: SUBDL_API_KEY,
    imdb_id: imdbId,
    languages,
  });
  try {
    const r = await fetch(`${SUBDL_BASE}?${params.toString()}`);
    if (!r.ok) {
      res.status(r.status).json({ error: `SubDL ${r.status}` });
      return;
    }
    // Stream the body straight through — keep SubDL's JSON shape.
    const body = await r.text();
    res.status(200);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.send(body);
  } catch {
    res.status(502).json({ error: "Upstream SubDL call failed" });
  }
}

/* ───────────────────────────  Router  ─────────────────────────── */

export default async function handler(req: any, res: any): Promise<void> {
  applyCors();

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  // Vercel gives us `req.url` like "/api/subtitles/tmdb-external-ids?...".
  // Strip the function path so we route by suffix.
  const rawUrl: string = req.url ?? "/";
  const pathOnly = rawUrl.split("?")[0].replace(/\/+$/, "");
  const subPath = pathOnly.replace(/^\/?api\/subtitles\/?/, "");

  if (subPath === "tmdb-external-ids") {
    await handleTmdbExternalIds(req, res);
  } else if (subPath === "subdl") {
    await handleSubdlLookup(req, res);
  } else {
    res.status(404).json({ error: "Not Found" });
  }
}
