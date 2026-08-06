/**
 * Server catalog endpoint.
 *
 * Returns the 6 embed servers for a given title. The client uses
 * this to populate the server switcher and to drive automatic
 * fallback when a server fails to load.
 *
 * Request:
 *   GET /api/servers?tmdbId=1399&type=tv&season=1&episode=1
 *
 * Response (success):
 *   200 {
 *     success: true,
 *     tmdbId: 1399,
 *     imdbId: "tt0944947",
 *     servers: [
 *       { index: 0, key: "premium-hls", label: "...", kind: "hls", url: "https://...m3u8", hasQuality: true },
 *       { index: 1, key: "vidsrc",     label: "...", kind: "iframe", url: "https://vidsrc...", hasQuality: false },
 *       ...
 *     ]
 *   }
 *
 * Response (server fully unreachable):
 *   503 { success: false, error: "STREAM_RESOLVER_URL not configured", servers: [] }
 *
 * The endpoint never throws — partial results are still useful
 * (the switcher will just show a "loading" state for the missing
 * ones).
 *
 * Runtime: Edge. Standard global `Request` / `Response` only.
 */

import { EMBED_SERVERS, buildEmbedUrl, type ServerTemplate } from "../src/data/servers";

export const config = {
  runtime: "edge",
};

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

/* ───────────────────────────  Upstream HLS resolver  ─────────────────────────── */

class UpstreamNotFoundError extends Error {
  constructor() {
    super("Upstream returned 404");
    this.name = "UpstreamNotFoundError";
  }
}

async function callUpstreamForHls(
  base: string,
  params: { tmdbId: string; type: string; season: string; episode: string },
): Promise<string | null> {
  const url = new URL(base);
  url.searchParams.set("tmdbId", params.tmdbId);
  url.searchParams.set("type", params.type);
  url.searchParams.set("season", params.season);
  url.searchParams.set("episode", params.episode);

  try {
    const r = await fetch(url.toString(), { method: "GET" });
    if (r.status === 404) throw new UpstreamNotFoundError();
    if (!r.ok) return null;
    const data = (await r.json()) as { streamUrl?: unknown };
    return typeof data?.streamUrl === "string" && data.streamUrl.length > 0
      ? data.streamUrl
      : null;
  } catch {
    return null;
  }
}

/* ───────────────────────────  IMDb lookup (for IMDb-keyed servers)  ─────────────────────────── */

const TMDB_BASE = "https://api.themoviedb.org/3";

async function fetchImdbId(
  tmdbId: string,
  mediaType: string,
  apiKey: string,
): Promise<string | null> {
  if (!apiKey) return null;
  const path = mediaType === "tv" ? "tv" : "movie";
  try {
    const r = await fetch(
      `${TMDB_BASE}/${path}/${tmdbId}/external_ids?api_key=${encodeURIComponent(apiKey)}`,
    );
    if (!r.ok) return null;
    const data = (await r.json()) as { imdb_id?: string | null };
    const id = data?.imdb_id;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/* ───────────────────────────  Server builder  ─────────────────────────── */

export interface ServerEntry {
  index: number;
  key: string;
  label: string;
  kind: "hls" | "iframe";
  url: string;
  hasQuality: boolean;
}

function buildServerEntry(
  template: ServerTemplate,
  url: string,
): ServerEntry {
  return {
    index: template.index,
    key: template.key,
    label: template.label,
    kind: template.kind,
    url,
    hasQuality: template.hasQuality,
  };
}

/* ───────────────────────────  Handler  ─────────────────────────── */

export default async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "GET") {
    return jsonResponse({ success: false, error: "Method Not Allowed" }, 405);
  }

  const url = new URL(request.url);
  const tmdbId = (url.searchParams.get("tmdbId") ?? "").trim();
  const type = (url.searchParams.get("type") ?? "movie").trim();
  const season = (url.searchParams.get("season") ?? "1").trim();
  const episode = (url.searchParams.get("episode") ?? "1").trim();

  if (!tmdbId) {
    return jsonResponse({ success: false, error: "Missing tmdbId", servers: [] }, 400);
  }
  if (type !== "movie" && type !== "tv") {
    return jsonResponse({ success: false, error: "Invalid type", servers: [] }, 400);
  }

  const upstream = process.env.STREAM_RESOLVER_URL ?? "";
  const tmdbApiKey = process.env.TMDB_API_KEY ?? "";

  // 1. Server 0 (HLS) — optional. If the operator hasn't configured
  //    STREAM_RESOLVER_URL we drop Server 0; the iframe servers still
  //    work.
  let hlsUrl: string | null = null;
  if (upstream) {
    hlsUrl = await callUpstreamForHls(upstream, { tmdbId, type, season, episode });
  }

  // 2. IMDb id — needed for Servers 2 and 5. If we can't resolve it
  //    those servers are dropped from the response.
  const imdbId = await fetchImdbId(tmdbId, type, tmdbApiKey);

  // 3. Build the entries.
  const substitution = { tmdbId, type, season, episode, imdbId: imdbId ?? undefined };
  const entries: ServerEntry[] = [];

  for (const tpl of EMBED_SERVERS) {
    if (tpl.index === 0) {
      if (!hlsUrl) continue; // no HLS source — skip
      entries.push(buildServerEntry(tpl, hlsUrl));
      continue;
    }
    const url2 = buildEmbedUrl(tpl.template, substitution);
    if (!url2) continue; // missing placeholder
    entries.push(buildServerEntry(tpl, url2));
  }

  return jsonResponse(
    {
      success: true,
      tmdbId,
      imdbId,
      servers: entries,
    },
    200,
  );
}
