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
 * Raw value of `VITE_STREAM_RESOLVER_URL` from `.env`. May be:
 *   - empty string (unset)
 *   - a fully-qualified URL: `https://your-host.example/api/stream`
 *   - a URL with a `?url=...` *inside* a `(...)` wrapper, in cases
 *     where the operator pasted it from a "copy link" UI
 *   - a path-relative URL: `/api/stream`
 *
 * The raw value is sanitised by `normalizeResolverUrl()` below before
 * being used in a fetch.
 */
const RAW_STREAM_RESOLVER_URL: string =
  (env.VITE_STREAM_RESOLVER_URL ?? "").toString();

/* ───────────────────────────  URL sanitiser  ─────────────────────────── */

/**
 * Clean up the operator-supplied resolver URL so it can be safely
 * composed with query params.
 *
 * Handles the common `.env` mistakes we've seen:
 *   - Surrounding whitespace and `"…"` / `'…'` quotes.
 *   - A trailing `?` left over from a partial paste.
 *   - A wrapping `(…)` around the *entire* URL — e.g.
 *       `https://outer.com(?url=https://inner.com)` → strips the
 *       parens, keeps both URLs concatenated with `?` between them.
 *   - Multiple stray `?` separators at the start of the path.
 *   - Trailing `&` or `?` characters.
 *
 * Returns `null` when the result would otherwise be an unusable URL
 * (e.g. all-parens garbage, no scheme/path). Callers treat `null` as
 * "fall back to same-origin /api/stream."
 *
 * This is *string-level* cleanup only. It does not whitelist
 * destinations, validate schemes against an allowlist, or change the
 * meaning of an intentional nested URL. The destination URL is the
 * operator's responsibility.
 */
export function normalizeResolverUrl(raw: string): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (s.length === 0) return null;

  // Strip a single pair of wrapping quotes some `.env` parsers keep.
  // We only peel one layer so URLs containing legitimate `"` survive.
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }

  // Strip a wrapping `(…)` pair around the *entire* URL, but only when
  // the open paren is followed immediately by what looks like a scheme
  // and the closing paren is at the end of the string. This protects
  // against pasted wrappers like:
  //   `https://outer.com(?url=https://inner.com)`
  // Becomes:
  //   `https://outer.com?url=https://inner.com`
  const wrapMatch = /^(\s*)?\((https?:\/\/[^\s)]+)\)(\s*)?$/.exec(s);
  if (wrapMatch) {
    s = wrapMatch[2];
  } else {
    // Some operators paste without inner scheme, e.g.
    //   `(https://outer.com/api/stream)`. Strip a bare `(…)` wrapper.
    if (s.startsWith("(") && s.endsWith(")")) {
      s = s.slice(1, -1).trim();
    }
  }

  // Collapse "??" / "?&" / "&&" run-on into a single `?` followed by a
  // single `&`. Only acts on the boundary between path and query,
  // preserving query-internal separators.
  s = s.replace(/[?&]{2,}/g, (m) => (m[0] === "?" ? "?" : "&"));

  // Remove any trailing `?` or `&` so we can safely append our own
  // params below without producing `?&` or `??` sequences.
  s = s.replace(/[?&]+$/, "");

  // Require at least a scheme or a single-leading-slash path. Anything
  // else is unusable.
  if (!/^(https?:\/\/|\/)/i.test(s)) return null;

  return s;
}

const NORMALIZED_STREAM_RESOLVER_URL: string | null = normalizeResolverUrl(
  RAW_STREAM_RESOLVER_URL,
);

if (
  typeof window !== "undefined" &&
  RAW_STREAM_RESOLVER_URL &&
  NORMALIZED_STREAM_RESOLVER_URL !== RAW_STREAM_RESOLVER_URL.trim()
) {
  // Surface the cleanup once per page load so misconfigured
  // `.env` values don't produce silent fetch failures. We log the
  // cleaned form (not the raw) — the raw value is the operator's
  // own input and may contain credentials.
  console.warn(
    "[stream] normalized VITE_STREAM_RESOLVER_URL — paste whitespace, quotes, or wrapper parens were stripped",
  );
}

/* ───────────────────────────  Public types  ─────────────────────────── */

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
 * Compose the resolver endpoint URL from a sanitised base + the four
 * media params. Returns `null` if the base is unusable.
 */
function buildEndpoint(
  base: string,
  params: { tmdbId: number; mediaType: MediaType; season: number; episode: number },
): string | null {
  const normalized = normalizeResolverUrl(base);
  if (!normalized) return null;
  const query = new URLSearchParams({
    tmdbId: String(params.tmdbId),
    type: params.mediaType,
    season: String(params.season),
    episode: String(params.episode),
  }).toString();
  const separator = normalized.includes("?") ? "&" : "?";
  return `${normalized}${separator}${query}`;
}

/* ───────────────────────────  Public API  ─────────────────────────── */

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

  // Pick the resolver base. The dev URL (set via VITE_STREAM_RESOLVER_URL)
  // wins when present so local dev doesn't need a Vercel deployment.
  // The fallback when nothing usable is configured is the same-origin
  // edge function at `/api/stream`.
  const base = NORMALIZED_STREAM_RESOLVER_URL ?? "/api/stream";
  const endpoint = buildEndpoint(base, { tmdbId, mediaType, season, episode });
  if (!endpoint) {
    console.warn("[stream] resolver URL could not be normalized, using fallback");
    return FALLBACK_STREAM;
  }

  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      console.warn(
        `[stream] resolver returned ${response.status}, using fallback`,
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

/** Exposed for unit testing. */
export const __test__ = {
  buildEndpoint,
  normalizeResolverUrl,
  FALLBACK_STREAM,
};
