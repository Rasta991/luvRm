/**
 * Client-side stream resolver.
 *
 * Resolves a direct HLS (`.m3u8`) URL for `<VideoPlayer streamUrl=…>`
 * in three layers, from highest to lowest priority:
 *
 *   1. `customStreamUrl` (from room state). Short-circuits — no fetch.
 *   2. `VITE_STREAM_RESOLVER_URL` if set. Lets the operator point at a
 *      local dev endpoint (e.g. `http://localhost:3000/api/stream`)
 *      without needing to spin up Vercel locally.
 *   3. Same-origin `/api/stream`. The Vercel edge function reads
 *      `STREAM_RESOLVER_URL` (server-side) to forward to a real
 *      upstream. This is the production-correct path.
 *
 * Fallback: Mux's public test stream. Returned whenever the resolver
 * is missing, errors, or returns a malformed response, so the player
 * never receives an empty `streamUrl`.
 *
 * This module does NOT reference or route to any third-party proxy
 * domain. Operators configure their own resolver via the env vars.
 */

import type { MediaType } from "../data/catalog";

/** Public Mux test stream — used as the absolute-last-resort fallback. */
const FALLBACK_STREAM = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

// `import.meta.env` is Vite's typed env accessor. We avoid importing
// `vite/client` types and instead declare the shape we use, so this
// file stays self-contained.
const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};

/**
 * Resolver URL pinned at build time by Vite (any `VITE_*` variable is
 * inlined). When undefined we fall through to the same-origin
 * `/api/stream` edge function.
 */
const VITE_STREAM_RESOLVER_URL: string =
  (env.VITE_STREAM_RESOLVER_URL ?? "").trim();

export interface StreamParams {
  tmdbId: number;
  mediaType: MediaType;
  season?: number;
  episode?: number;
  /** Host-supplied direct stream URL (e.g. from room state). Wins immediately. */
  customStreamUrl?: string | null;
}

/** Shape returned by the resolver. Accepts both `streamUrl` and `url`. */
interface ResolverResponse {
  success?: boolean;
  streamUrl?: string;
  url?: string;
}

/** Pick the manifest URL from a resolver response, or return `null`. */
function pickStreamUrl(data: ResolverResponse | null): string | null {
  if (!data || typeof data !== "object") return null;
  const raw = data.streamUrl ?? data.url;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

/**
 * Resolve the direct HLS manifest URL for a given title. Always
 * returns a non-empty string — callers can pass the result directly to
 * `<VideoPlayer streamUrl=...>` without null-checking.
 */
export async function fetchDirectStreamUrl({
  tmdbId,
  mediaType,
  season = 1,
  episode = 1,
  customStreamUrl,
}: StreamParams): Promise<string> {
  // 1. Host-provided URL — short-circuit, no fetch.
  if (customStreamUrl && customStreamUrl.trim().length > 0) {
    return customStreamUrl;
  }

  // 2. No title resolved yet — return the fallback so the player has
  //    something to render while we wait on the host. The room UI
  //    shows a "no media" overlay above the player during this.
  if (!tmdbId) return FALLBACK_STREAM;

  const query = new URLSearchParams({
    tmdbId: String(tmdbId),
    type: mediaType,
    season: String(season),
    episode: String(episode),
  }).toString();

  // Pick the resolver base. The dev URL (set via VITE_STREAM_RESOLVER_URL)
  // wins when present so local dev doesn't need a Vercel deployment.
  const baseUrl = VITE_STREAM_RESOLVER_URL || "/api/stream";
  const separator = baseUrl.includes("?") ? "&" : "?";
  const endpoint = `${baseUrl}${separator}${query}`;

  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      console.warn(
        `[stream] resolver ${endpoint} returned ${response.status}, using fallback`,
      );
      return FALLBACK_STREAM;
    }
    const data = (await response.json()) as ResolverResponse;
    const streamUrl = pickStreamUrl(data);
    if (streamUrl) return streamUrl;
    console.warn("[stream] resolver response missing streamUrl/url, using fallback");
    return FALLBACK_STREAM;
  } catch (err) {
    console.warn("[stream] resolver fetch failed, using fallback:", err);
    return FALLBACK_STREAM;
  }
}
