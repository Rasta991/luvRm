/**
 * Embed server catalog.
 *
 * Single source of truth for the 6 video servers exposed to the user.
 * Both the serverless `/api/servers` endpoint and the client use this
 * template list so adding / removing / reordering a server is a
 * one-file change.
 *
 * Each entry declares:
 *   - `kind`     — "hls" (uses hls.js on the client) or "iframe" (embed page)
 *   - `key`      — stable identifier used in analytics + logs
 *   - `label`    — human-readable label, shown in the UI ("Server 1 — Premium HLS")
 *   - `provider` — short provider name shown on the switcher pill
 *   - `template` — URL template with `{tmdbId}`, `{type}`, `{season}`,
 *                  `{episode}`, `{imdbId}` placeholders. The placeholder
 *                  is left unreplaced (and the server dropped) when the
 *                  value is missing.
 *
 * Provider notes (the operators reported as fast + unblocked in
 * Iraq / Middle East as of 2026):
 *   - VidSrc        : large catalog, HLS, subbed via their own menu
 *   - 2Embed        : reliable, IMDb-keyed, multi-language
 *   - AutoEmbed     : TMDB-keyed, good mobile performance
 *   - MultiEmbed    : TMDB-keyed, supports quality= param
 *   - SmashyStream  : IMDb-keyed, lower resolver latency
 *   - Premium HLS   : operator's own STREAM_RESOLVER_URL → m3u8
 */

export type ServerKind = "hls" | "iframe";

export interface ServerTemplate {
  /** 0-based index. Stable across deploys. */
  index: number;
  kind: ServerKind;
  /** Stable analytics key, e.g. "vidsrc". */
  key: string;
  /** Long label, e.g. "Server 1 — Premium HLS". Shown in tooltips. */
  label: string;
  /** Short provider label, e.g. "Vidsrc". Shown on the pill. */
  provider: string;
  /** URL template (URL-encoded at substitution time). */
  template: string;
  /** Declarative flag: does this server benefit from the quality menu? */
  hasQuality: boolean;
  /** Placeholders required by the template. Missing placeholders drop
   *  the server from the response. */
  needs: ReadonlyArray<"tmdbId" | "type" | "season" | "episode" | "imdbId">;
}

export const EMBED_SERVERS: ReadonlyArray<ServerTemplate> = [
  {
    index: 0,
    kind: "hls",
    key: "premium-hls",
    label: "Server 1 — Premium HLS",
    provider: "HLS",
    // Server 0 is special: the URL is rebuilt by the resolver on the
    // server side, not by simple template substitution. We keep a
    // dummy template here so the catalog stays uniform; the API
    // endpoint swaps it out for the actual `streamUrl` returned by
    // `STREAM_RESOLVER_URL`.
    template: "__resolver__",
    hasQuality: true,
    needs: ["tmdbId", "type", "season", "episode"],
  },
  {
    index: 1,
    kind: "iframe",
    key: "vidsrc",
    label: "Server 2 — VidSrc",
    provider: "Vidsrc",
    template: "https://vidsrc.to/embed/{type}/{tmdbId}/{season}/{episode}",
    hasQuality: false,
    needs: ["tmdbId", "type", "season", "episode"],
  },
  {
    index: 2,
    kind: "iframe",
    key: "2embed",
    label: "Server 3 — 2Embed",
    provider: "2Embed",
    template: "https://www.2embed.cc/embed/{imdbId}",
    hasQuality: false,
    needs: ["imdbId"],
  },
  {
    index: 3,
    kind: "iframe",
    key: "autoembed",
    label: "Server 4 — AutoEmbed",
    provider: "AutoEmbed",
    template: "https://autoembed.to/embed/tmdb/{type}/{tmdbId}-{season}-{episode}",
    hasQuality: false,
    needs: ["tmdbId", "type", "season", "episode"],
  },
  {
    index: 4,
    kind: "iframe",
    key: "multiembed",
    label: "Server 5 — MultiEmbed",
    provider: "MultiEmbed",
    template: "https://multiembed.mov/?video_id={tmdbId}&tmdb=1&s={season}&e={episode}",
    hasQuality: true,
    needs: ["tmdbId", "season", "episode"],
  },
  {
    index: 5,
    kind: "iframe",
    key: "smashy",
    label: "Server 6 — Smashy",
    provider: "Smashy",
    template: "https://player.smashy.stream/{imdbId}",
    hasQuality: false,
    needs: ["imdbId"],
  },
];

/**
 * Substitute placeholders in a template. Values are URL-encoded so an
 * IMDb id like `tt0944947` survives, and a future `?` query in the
 * template (e.g. `&foo=bar`) is not double-encoded.
 *
 * Returns `null` when a required placeholder is missing — callers
 * drop the server in that case.
 */
export function buildEmbedUrl(
  template: string,
  values: {
    tmdbId?: number | string;
    type?: string;
    season?: number | string;
    episode?: number | string;
    imdbId?: string;
  },
): string | null {
  // Pull out the placeholders the template actually declares.
  const required = Array.from(template.matchAll(/\{(\w+)\}/g)).map((m) => m[1]);
  for (const key of required) {
    const raw = (values as Record<string, unknown>)[key];
    if (raw === undefined || raw === null || raw === "") return null;
  }
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const raw = (values as Record<string, unknown>)[key];
    return encodeURIComponent(String(raw));
  });
}

/** Lookup a template by its stable key. */
export function findServerByKey(key: string): ServerTemplate | undefined {
  return EMBED_SERVERS.find((s) => s.key === key);
}
