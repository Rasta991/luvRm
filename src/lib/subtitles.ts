/**
 * Subtitle lookup for the room player.
 *
 * Pipeline:
 *   1. Resolve the IMDb ID for a TMDB entry via TMDB's `external_ids`
 *      endpoint (uses the same VITE_TMDB_API_KEY as `lib/tmdb.ts`).
 *   2. Query SubDL for the highest-rated Arabic subtitle.
 *   3. Fetch the subtitle bytes, detect SRT vs WebVTT, and convert
 *      SRT → WebVTT in the browser so `<track>` elements accept it.
 *
 * Routing:
 *   - If `VITE_SUBDL_PROXY_URL` is set (recommended for production),
 *     all SubDL + TMDB external_ids calls go through *your* server
 *     function. The SubDL API key never reaches the browser.
 *   - Otherwise, the browser calls `api.subdl.com` directly using
 *     `VITE_SUBDL_API_KEY`. This works for local dev but trips CORS
 *     in production browsers.
 *
 * Result shape (matches `SubtitleTrack` from `components/VideoPlayer`):
 *   { lang: "ar", label: "العربية", file: <blob: URL or /api/...> }
 *
 * We return a `blob:` URL for the converted file so the subtitle lives
 * in-memory and works without a second network round-trip per peer.
 * (For very long sessions you may want to revoke the URL manually.)
 */

import type { SubtitleTrack } from "../components/VideoPlayer";
import type { MediaType } from "../data/catalog";

const TMDB_BASE = "https://api.themoviedb.org/3";
const SUBDL_BASE = "https://api.subdl.com/api/v1/subtitles";
const SUBDL_DL_BASE = "https://dl.subdl.com";

const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};

const VITE_TMDB_API_KEY = env.VITE_TMDB_API_KEY ?? "";
const VITE_SUBDL_API_KEY = env.VITE_SUBDL_API_KEY ?? "";
// Default to the local serverless route so the browser never reaches
// api.subdl.com unless explicitly told to. Relative path = same origin
// as the app, no CORS preflight needed.
const VITE_SUBDL_PROXY_URL = env.VITE_SUBDL_PROXY_URL || "/api/subtitles";

/* ───────────────────────────  SubDL response shape  ─────────────────────────── */

interface SubdlSubtitle {
  sd_id: string;
  language?: string;
  name?: string;
  release?: string;
  url?: string;
  uploader?: { name?: string };
  rating?: number;
  download_count?: number;
  hi?: boolean;
  format?: string; // "WEB-DL", "BluRay", etc.
}

interface SubdlResponse {
  status: boolean;
  results?: SubdlSubtitle[];
  subtitles?: SubdlSubtitle[]; // older API quirk: both keys have appeared
}

/* ───────────────────────────  Low-level HTTP  ─────────────────────────── */

async function httpGet(url: string, _headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url);
}

/* ───────────────────────────  TMDB → IMDb resolution  ─────────────────────────── */

interface TmdbExternalIds {
  imdb_id?: string | null;
  tvdb_id?: number | null;
  facebook_id?: string | null;
  instagram_id?: string | null;
  twitter_id?: string | null;
}

/**
 * Convert a TMDB id to an IMDb id (`tt1234567`).
 * Returns null when no key is configured, the id is unknown, or the
 * network call fails.
 */
export async function getImdbId(tmdbId: number, mediaType: MediaType): Promise<string | null> {
  if (!tmdbId) return null;

  // Use the proxy if it's configured — keeps the TMDB key server-side.
  const path = mediaType === "tv" ? "tv" : "movie";
  let url: string;

  if (VITE_SUBDL_PROXY_URL) {
    url = `${VITE_SUBDL_PROXY_URL.replace(/\/$/, "")}/tmdb-external-ids?tmdbId=${tmdbId}&mediaType=${path}`;
  } else if (VITE_TMDB_API_KEY) {
    url = `${TMDB_BASE}/${path}/${tmdbId}/external_ids?api_key=${encodeURIComponent(VITE_TMDB_API_KEY)}`;
  } else {
    return null;
  }

  try {
    const r = await httpGet(url);
    if (!r.ok) return null;
    const data = (await r.json()) as TmdbExternalIds;
    const id = data?.imdb_id;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/* ───────────────────────────  SRT → WebVTT converter  ─────────────────────────── */

// BOM character constant (U+FEFF), expressed as an escape so it doesn't
// get mangled by editors that try to be clever about BOMs.
const BOM = "﻿";

/**
 * Convert SubRip (`.srt`) subtitle text to WebVTT.
 *
 * SRT differs from WebVTT in two ways the browser actually cares about:
 *   1. WebVTT requires the literal header `WEBVTT` on the first line.
 *   2. SRT uses `00:00:00,000 --> 00:00:00,000` (comma decimal).
 *      WebVTT uses `00:00:00.000 --> 00:00:00.000` (dot decimal).
 *
 * This parser is intentionally permissive — it does not validate every
 * cue, just normalises the common breakage so the file plays in
 * `<track>`.
 */
export function srtToVtt(srt: string): string {
  // Strip a leading BOM (if any) and normalise line endings to LF.
  let clean = srt;
  if (clean.startsWith(BOM)) clean = clean.slice(BOM.length);
  clean = clean.replace(/\r\n?/g, "\n");

  // The header. WebVTT requires this as the very first line.
  const header = "WEBVTT\n\n";

  // `g` flag — every timestamp in the file.
  const body = clean.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    (_match: string, a: string, b: string, c: string, d: string) => {
      return `${a}.${b} --> ${c}.${d}`;
    },
  );

  return header + body.trimStart();
}

/** Detect whether a subtitle body is SRT (vs already-WebVTT). */
export function isLikelySrt(body: string): boolean {
  let head = body;
  if (head.startsWith(BOM)) head = head.slice(BOM.length);
  head = head.trimStart().slice(0, 64);
  return !/^WEBVTT/i.test(head);
}

/* ───────────────────────────  SubDL fetch  ─────────────────────────── */

interface SubdlFetchResult {
  /** Absolute URL to download the subtitle from (SubDL's CDN). */
  downloadUrl: string;
  /** File extension hint from the URL, e.g. "srt" or "vtt". */
  format: "srt" | "vtt" | "unknown";
}

/**
 * Ask SubDL for the best Arabic subtitle for an IMDb id.
 * Returns the top-ranked download URL, or null when nothing is found.
 */
async function lookupSubtitleDownload(imdbId: string): Promise<SubdlFetchResult | null> {
  const params = new URLSearchParams();
  params.set("imdb_id", imdbId);
  params.set("languages", "sd_ar");

  let url: string;
  if (VITE_SUBDL_PROXY_URL) {
    url = `${VITE_SUBDL_PROXY_URL.replace(/\/$/, "")}/subdl?${params.toString()}`;
  } else if (VITE_SUBDL_API_KEY) {
    params.set("api_key", VITE_SUBDL_API_KEY);
    url = `${SUBDL_BASE}?${params.toString()}`;
  } else {
    return null;
  }

  try {
    const r = await httpGet(url);
    if (!r.ok) return null;
    const data = (await r.json()) as SubdlResponse;
    if (!data?.status) return null;
    const list = data.subtitles ?? data.results ?? [];
    if (list.length === 0) return null;

    // Sort by SubDL's own rating, then download_count. Top of the
    // list is the best match for "the first Arabic subtitle".
    const ranked = [...list].sort((a, b) => {
      const ar = b.rating ?? 0;
      const br = a.rating ?? 0;
      if (ar !== br) return ar - br;
      return (b.download_count ?? 0) - (a.download_count ?? 0);
    });

    // Resolve the download URL. SubDL returns either an absolute URL
    // (`https://dl.subdl.com/<id>`) or a `subdl://` URL we have to
    // translate. Relative paths get prefixed with the main storage
    // domain.
    let dl = ranked[0]?.url ?? "";
    if (!dl) return null;
    if (dl.startsWith("subdl://")) dl = `${SUBDL_DL_BASE}/${dl.slice("subdl://".length)}`;
    if (dl.startsWith("/")) dl = `${SUBDL_DL_BASE}${dl}`;
    if (!/^https?:\/\//i.test(dl)) return null;

    const lower = dl.toLowerCase();
    const format: SubdlFetchResult["format"] = lower.endsWith(".vtt")
      ? "vtt"
      : lower.endsWith(".srt")
        ? "srt"
        : "unknown";

    return { downloadUrl: dl, format };
  } catch {
    return null;
  }
}

/**
 * Download the subtitle bytes and convert SRT → WebVTT when needed.
 * Returns a `blob:` URL suitable for `<track src=...>`.
 */
async function fetchAndConvert(dl: SubdlFetchResult): Promise<{ url: string; format: "vtt" } | null> {
  try {
    const r = await httpGet(dl.downloadUrl);
    if (!r.ok) return null;
    const body = await r.text();
    if (!body) return null;

    if (dl.format === "vtt" || (dl.format === "unknown" && !isLikelySrt(body))) {
      const blob = new Blob([body], { type: "text/vtt" });
      return { url: URL.createObjectURL(blob), format: "vtt" };
    }
    const vtt = srtToVtt(body);
    const blob = new Blob([vtt], { type: "text/vtt" });
    return { url: URL.createObjectURL(blob), format: "vtt" };
  } catch {
    return null;
  }
}

/* ───────────────────────────  Public API  ─────────────────────────── */

/**
 * Resolve the best Arabic subtitle for a TMDB id.
 * Returns a `SubtitleTrack` ready to pass to `<VideoPlayer subtitles=...>`.
 * Returns `null` when no configuration is present, no IMDb id exists, or
 * SubDL has no Arabic subtitle for this title.
 *
 * Caching: callers are responsible for memoizing the result; this
 * function does an HTTP round-trip to TMDB + SubDL + the subtitle CDN.
 */
export async function fetchArabicSubtitle(
  tmdbId: number,
  mediaType: MediaType,
): Promise<SubtitleTrack | null> {
  if (!tmdbId) return null;

  // The proxy URL is always populated now (defaults to `/api/subtitles`).
  // If the *serverless function itself* is missing `SUBDL_API_KEY`, the
  // proxy returns 500 and we surface that as a missing subtitle — which
  // is the right behaviour. The only "silent skip" path left is when
  // the user explicitly wants to disable the feature.

  const imdbId = await getImdbId(tmdbId, mediaType);
  if (!imdbId) return null;

  const dl = await lookupSubtitleDownload(imdbId);
  if (!dl) return null;

  const file = await fetchAndConvert(dl);
  if (!file) return null;

  return {
    lang: "ar",
    label: "العربية",
    file: file.url,
    default: true,
  };
}
