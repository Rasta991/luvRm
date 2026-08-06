/**
 * Client-side stream resolver.
 *
 * Resolves the list of embed servers for `<VideoPlayer />` in three
 * layers, from highest to lowest priority:
 *
 *   1. `customStreamUrl` (from room state). Short-circuits — no fetch.
 *      The URL is wrapped as a single HLS server at index 0.
 *   2. `VITE_STREAM_RESOLVER_URL` if set. Lets the operator point at a
 *      local dev endpoint (e.g. `http://localhost:3000/api/stream`)
 *      without needing to spin up Vercel locally.
 *   3. Same-origin `/api/servers`. The Vercel edge function reads
 *      `STREAM_RESOLVER_URL` (server-side) to forward to a real
 *      upstream, and returns the full 6-server catalog.
 *
 * On any failure (network, missing resolver, 404, malformed
 * response) the function returns an empty array so the player can
 * surface an honest "no stream configured" state. There is no
 * client-side fallback stream.
 *
 * This module does NOT reference or route to any third-party proxy
 * domain. Operators configure their own resolver via the env vars.
 */

import type { MediaType } from "../data/catalog";

const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};

const RAW_STREAM_RESOLVER_URL: string =
  (env.VITE_STREAM_RESOLVER_URL ?? "").toString();

/* ───────────────────────────  URL sanitiser  ─────────────────────────── */

export function normalizeResolverUrl(raw: string): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (s.length === 0) return null;

  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }

  const wrapMatch = /^(\s*)?\((https?:\/\/[^\s)]+)\)(\s*)?$/.exec(s);
  if (wrapMatch) {
    s = wrapMatch[2];
  } else {
    if (s.startsWith("(") && s.endsWith(")")) {
      s = s.slice(1, -1).trim();
    }
  }

  s = s.replace(/[?&]{2,}/g, (m) => (m[0] === "?" ? "?" : "&"));
  s = s.replace(/[?&]+$/, "");

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
  console.warn(
    "[stream] normalized VITE_STREAM_RESOLVER_URL — paste whitespace, quotes, or wrapper parens were stripped",
  );
}

/* ───────────────────────────  Public types  ─────────────────────────── */

export interface EmbedServer {
  index: number;
  key: string;
  label: string;
  /** Short provider label, e.g. "Vidsrc". Shown on the switcher pill. */
  provider: string;
  kind: "hls" | "iframe";
  url: string;
  hasQuality: boolean;
}

export interface StreamParams {
  tmdbId: number;
  mediaType: MediaType;
  season?: number;
  episode?: number;
  /** Host-supplied direct stream URL (e.g. from room state). Wins immediately. */
  customStreamUrl?: string | null;
}

/** Server-list response shape from `/api/servers` or `/api/stream`. */
interface ServerListResponse {
  success?: boolean;
  servers?: EmbedServer[];
  streamUrl?: string;
  imdbId?: string | null;
  error?: string;
}

/* ───────────────────────────  Public API  ─────────────────────────── */

/**
 * Resolve the 6-server catalog for a given title. Returns an empty
 * array when there is nothing playable — callers should treat that
 * as an honest "no stream configured" state.
 */
export async function fetchEmbedServers({
  tmdbId,
  mediaType,
  season = 1,
  episode = 1,
  customStreamUrl,
}: StreamParams): Promise<EmbedServer[]> {
  // 1. Host-provided URL — short-circuit, no fetch. Wrap as a single
  //    HLS server at index 0 so the player treats it uniformly.
  if (customStreamUrl && customStreamUrl.trim().length > 0) {
    return [
      {
        index: 0,
        key: "custom",
        label: "Server 1 — Custom stream",
        provider: "Custom",
        kind: "hls",
        url: customStreamUrl,
        hasQuality: true,
      },
    ];
  }

  // 2. No title resolved yet — nothing to resolve against.
  if (!tmdbId) return [];

  const query = new URLSearchParams({
    tmdbId: String(tmdbId),
    type: mediaType,
    season: String(season),
    episode: String(episode),
  }).toString();

  // 3. Try the developer-configured resolver first (so local dev
  //    doesn't need a Vercel deploy). Then fall back to the same-origin
  //    `/api/servers` endpoint.
  const candidates = [
    NORMALIZED_STREAM_RESOLVER_URL,
    "/api/servers",
  ].filter((u): u is string => Boolean(u));

  for (const base of candidates) {
    const separator = base.includes("?") ? "&" : "?";
    const endpoint = `${base}${separator}${query}`;
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        console.warn(`[stream] ${base} returned ${response.status}`);
        continue;
      }
      const data = (await response.json()) as ServerListResponse;
      const list = Array.isArray(data?.servers) ? data.servers : null;
      if (list && list.length > 0) {
        // Normalize — sort by index defensively in case the server returns
        // a different order.
        const sorted = [...list].sort((a, b) => a.index - b.index);
        return sorted;
      }
      // Legacy shape: just a single streamUrl. Wrap it as a single HLS
      // server so the player pipeline still works.
      if (typeof data?.streamUrl === "string" && data.streamUrl.length > 0) {
        return [
          {
            index: 0,
            key: "premium-hls",
            label: "Server 1 — Premium HLS",
            provider: "HLS",
            kind: "hls",
            url: data.streamUrl,
            hasQuality: true,
          },
        ];
      }
      console.warn(`[stream] ${base} response missing servers/streamUrl`);
    } catch (err) {
      console.warn(`[stream] ${base} fetch failed:`, err);
      continue;
    }
  }

  return [];
}

/**
 * Backward-compatible "give me the first HLS server" wrapper. Kept
 * for callers that haven't migrated to the 6-server list yet.
 */
export async function fetchDirectStreamUrl(
  params: StreamParams,
): Promise<string | null> {
  const servers = await fetchEmbedServers(params);
  const hls = servers.find((s) => s.kind === "hls");
  return hls?.url ?? null;
}

/** Exposed for unit testing. */
export const __test__ = {
  normalizeResolverUrl,
};
