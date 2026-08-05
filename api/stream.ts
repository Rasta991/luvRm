/**
 * Pluggable stream resolver.
 *
 * This function does NOT scrape, embed, or hardcode any upstream video
 * source. Instead it forwards the request to an upstream URL set via
 * the `STREAM_RESOLVER_URL` environment variable. Operators wire this
 * to whatever legitimate backend they own — Mux, Cloudflare Stream,
 * Bunny, an internal signed-URL endpoint, etc.
 *
 * Request:
 *   GET /api/stream?tmdbId=1399&type=tv&season=1&episode=1
 *
 * Response (success):
 *   200 { success: true, streamUrl: "https://…m3u8" }
 *
 * Response (no resolver configured):
 *   503 { success: false, error: "STREAM_RESOLVER_URL not configured" }
 *
 * Response (upstream error):
 *   502 { success: false, error: "<message>" }
 *
 * Runtime: Edge. Standard global `Request` / `Response` only.
 */

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

/** Forward the request to the configured upstream resolver. */
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
  if (!r.ok) {
    throw new Error(`Upstream returned ${r.status}`);
  }
  const data = (await r.json()) as { streamUrl?: unknown };
  if (typeof data?.streamUrl !== "string" || data.streamUrl.length === 0) {
    throw new Error("Upstream response missing streamUrl");
  }
  return { streamUrl: data.streamUrl };
}

export default async function handler(request: Request): Promise<Response> {
  // CORS preflight.
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

  if (!tmdbId) {
    return jsonResponse({ success: false, error: "Missing tmdbId" }, 400);
  }
  if (type !== "movie" && type !== "tv") {
    return jsonResponse({ success: false, error: "Invalid type" }, 400);
  }

  const upstream = process.env.STREAM_RESOLVER_URL;
  if (!upstream) {
    return jsonResponse(
      { success: false, error: "STREAM_RESOLVER_URL not configured" },
      503,
    );
  }

  try {
    const { streamUrl } = await callUpstream(upstream, { tmdbId, type, season, episode });
    return jsonResponse({ success: true, streamUrl }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown upstream error";
    return jsonResponse({ success: false, error: message }, 502);
  }
}