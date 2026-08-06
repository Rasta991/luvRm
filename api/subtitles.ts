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
 * Configure on Vercel (server-side — NOT VITE_*):
 *   SUBDL_API_KEY=...
 *   TMDB_API_KEY=...
 *
 * Set `VITE_SUBDL_PROXY_URL` on the client to point here.
 *
 * Runtime: Edge. Standard global `Request` / `Response` only.
 */

export const config = {
  runtime: "edge",
};

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

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

/* ───────────────────────────  Route handlers  ─────────────────────────── */

async function handleTmdbExternalIds(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const tmdbId = Number(url.searchParams.get("tmdbId") ?? 0);
  const mediaType = url.searchParams.get("mediaType") ?? "movie";
  if (!tmdbId || (mediaType !== "movie" && mediaType !== "tv")) {
    return jsonResponse({ error: "Bad tmdbId/mediaType" }, 400);
  }
  if (!TMDB_API_KEY) {
    return jsonResponse({ error: "TMDB_API_KEY not configured" }, 500);
  }

  const upstream = `${TMDB_BASE}/${mediaType}/${tmdbId}/external_ids?api_key=${encodeURIComponent(TMDB_API_KEY)}`;
  try {
    const r = await fetch(upstream);
    if (!r.ok) {
      return jsonResponse({ error: `TMDB ${r.status}` }, r.status);
    }
    const data = (await r.json()) as { imdb_id?: string | null };
    return jsonResponse({ imdb_id: data?.imdb_id ?? null }, 200);
  } catch {
    return jsonResponse({ error: "Upstream TMDB call failed" }, 502);
  }
}

async function handleSubdlLookup(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const imdbId = (url.searchParams.get("imdb_id") ?? "").trim();
  const languages = url.searchParams.get("languages") ?? "sd_ar";
  if (!imdbId) {
    return jsonResponse({ error: "Missing imdb_id" }, 400);
  }
  if (!SUBDL_API_KEY) {
    return jsonResponse({ error: "SUBDL_API_KEY not configured" }, 500);
  }

  const params = new URLSearchParams({
    api_key: SUBDL_API_KEY,
    imdb_id: imdbId,
    languages,
  });
  try {
    const r = await fetch(`${SUBDL_BASE}?${params.toString()}`);
    if (!r.ok) {
      return jsonResponse({ error: `SubDL ${r.status}` }, r.status);
    }
    const body = await r.text();
    return new Response(body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch {
    return jsonResponse({ error: "Upstream SubDL call failed" }, 502);
  }
}

/* ───────────────────────────  Router  ─────────────────────────── */

export default async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  // Vercel gives us `request.url` like "/api/subtitles/tmdb-external-ids?...".
  // Strip the function path so we route by suffix.
  const rawUrl = request.url ?? "/";
  const pathOnly = rawUrl.split("?")[0].replace(/\/+$/, "");
  const subPath = pathOnly.replace(/^\/?api\/subtitles\/?/, "");

  if (subPath === "tmdb-external-ids") {
    return handleTmdbExternalIds(request);
  }
  if (subPath === "subdl") {
    return handleSubdlLookup(request);
  }
  return jsonResponse({ error: "Not Found" }, 404);
}
