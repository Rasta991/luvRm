/**
 * Stream resolver — extended to return the full server list.
 *
 * Falls through to the same upstream resolver as before, but now
 * fans out into the 6-server catalog (matching `/api/servers`).
 *
 * Request:
 *   GET /api/stream?tmdbId=1399&type=tv&season=1&episode=1
 *
 *   Optional `?include=all` (default) returns all 6 servers.
 *   `?include=hls` returns only the HLS server (Server 0).
 *
 * Response (success):
 *   200 {
 *     success: true,
 *     streamUrl: "https://...m3u8",
 *     servers: [
 *       { index: 0, key: "premium-hls", label: "...", kind: "hls",    url: "...", hasQuality: true },
 *       { index: 1, key: "vidsrc",     label: "...", kind: "iframe", url: "...", hasQuality: false },
 *       ...
 *     ],
 *     imdbId: "tt0944947"
 *   }
 *
 * The `streamUrl` field is preserved for backward compatibility
 * with the existing client. New clients should use `servers`
 * directly.
 *
 * Response (no resolver configured):
 *   503 { success: false, error: "STREAM_RESOLVER_URL not configured", servers: [] }
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

class UpstreamNotFoundError extends Error {
  constructor() {
    super("Upstream returned 404");
    this.name = "UpstreamNotFoundError";
  }
}

async function callUpstream(
  upstream: string,
  params: { tmdbId: string; type: string; season: string; episode: string },
): Promise<{ streamUrl: string }> {
  const url = new URL(upstream);
  url.searchParams.set("tmdbId", params.tmdbId);
  url.searchParams.set("type", params.type);
  url.searchParams.set("season", params.season);
  url.searchParams.set("episode", params.episode);

  const r = await fetch(url.toString(), { method: "GET" });
  if (r.status === 404) throw new UpstreamNotFoundError();
  if (!r.ok) throw new Error(`Upstream returned ${r.status}`);
  const data = (await r.json()) as { streamUrl?: unknown };
  if (typeof data?.streamUrl !== "string" || data.streamUrl.length === 0) {
    throw new Error("Upstream response missing streamUrl");
  }
  return { streamUrl: data.streamUrl };
}

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

interface ServerEntry {
  index: number;
  key: string;
  label: string;
  kind: "hls" | "iframe";
  url: string;
  hasQuality: boolean;
}

function buildEntry(tpl: ServerTemplate, url: string): ServerEntry {
  return {
    index: tpl.index,
    key: tpl.key,
    label: tpl.label,
    kind: tpl.kind,
    url,
    hasQuality: tpl.hasQuality,
  };
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "GET") {
    return jsonResponse({ success: false, error: "Method Not Allowed" }, 405);
  }

  const url = new URL(request.url);
  const tmdbId = url.searchParams.get("tmdbId") ?? "";
  const type = url.searchParams.get("type") ?? "movie";
  const season = url.searchParams.get("season") ?? "1";
  const episode = url.searchParams.get("episode") ?? "1";
  const include = (url.searchParams.get("include") ?? "all").toLowerCase();

  if (!tmdbId) {
    return jsonResponse({ success: false, error: "Missing tmdbId", servers: [] }, 400);
  }
  if (type !== "movie" && type !== "tv") {
    return jsonResponse({ success: false, error: "Invalid type", servers: [] }, 400);
  }

  const upstream = process.env.STREAM_RESOLVER_URL;
  const tmdbApiKey = process.env.TMDB_API_KEY ?? "";

  let streamUrl: string | null = null;
  if (upstream) {
    try {
      const r = await callUpstream(upstream, { tmdbId, type, season, episode });
      streamUrl = r.streamUrl;
    } catch (err) {
      if (err instanceof UpstreamNotFoundError) {
        return jsonResponse(
          { success: false, error: "No playable stream found", servers: [] },
          404,
        );
      }
      const message = err instanceof Error ? err.message : "Unknown upstream error";
      return jsonResponse({ success: false, error: message, servers: [] }, 502);
    }
  }

  // Build the server list. When the caller asked for `hls` we only
  // emit Server 0; for `all` we emit everything that resolves.
  const imdbId = await fetchImdbId(tmdbId, type, tmdbApiKey);
  const substitution = { tmdbId, type, season, episode, imdbId: imdbId ?? undefined };
  const servers: ServerEntry[] = [];

  if (streamUrl && include !== "none") {
    const tpl = EMBED_SERVERS[0];
    servers.push(buildEntry(tpl, streamUrl));
  }
  if (include !== "hls") {
    for (const tpl of EMBED_SERVERS) {
      if (tpl.index === 0) continue;
      const u = buildEmbedUrl(tpl.template, substitution);
      if (!u) continue;
      servers.push(buildEntry(tpl, u));
    }
  }

  return jsonResponse(
    {
      success: true,
      streamUrl: streamUrl ?? servers[0]?.url ?? null,
      imdbId,
      servers,
    },
    200,
  );
}
