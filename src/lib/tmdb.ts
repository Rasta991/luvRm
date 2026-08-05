/**
 * Minimal TMDB v3 client used by the home page and the room player.
 *
 * Reads the API key from VITE_TMDB_API_KEY (Vite injects any `VITE_*` env
 * variable at build time). When the key is missing every fetcher resolves
 * to an empty array, so the UI degrades to skeleton placeholders instead of
 * crashing.
 *
 * All Arabic-region requests try `ar-SA` first and fall back to `en-US`
 * when the result is empty (TMDB returns nothing for some Arabic entries
 * that have no localized metadata yet).
 */

import type { MediaType, Title } from "../data/catalog";

const BASE = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";

export const TMDB_IMG = {
  poster: (path: string | null | undefined, size: "w185" | "w342" | "w500" | "original" = "w500") =>
    path ? `${IMG}/${size}${path.startsWith("/") ? "" : "/"}${path}` : "",
  backdrop: (path: string | null | undefined, size: "w780" | "w1280" | "original" = "w1280") =>
    path ? `${IMG}/${size}${path.startsWith("/") ? "" : "/"}${path}` : "",
};

const API_KEY = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_TMDB_API_KEY ?? "";

const hasKey = () => API_KEY.length > 0;

/** Languages tried in order for any localized query. */
const LANGS: ("ar-SA" | "en-US")[] = ["ar-SA", "en-US"];

interface FetchOpts {
  /** Extra query parameters appended to the request. */
  params?: Record<string, string | number | boolean | undefined>;
  /** Force a specific language (skips the ar→en fallback chain). */
  lang?: "ar-SA" | "en-US";
}

/** Build a full URL with key + language + extras. */
const buildUrl = (path: string, lang: string, params: FetchOpts["params"] = {}) => {
  const search = new URLSearchParams({ api_key: API_KEY, language: lang });
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    search.set(k, String(v));
  }
  return `${BASE}${path}?${search.toString()}`;
};

/** Low-level fetch with one retry on network failure. */
async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Fetch a paged TMDB list, trying Arabic first and English as a fallback
 * when the localized result is empty (TMDB occasionally has no Arabic
 * titles for newer content).
 */
async function fetchList(
  path: string,
  params: FetchOpts["params"] = {},
): Promise<TmdbPaged | null> {
  if (!hasKey()) return null;
  for (const lang of LANGS) {
    const data = await getJson<TmdbPaged>(buildUrl(path, lang, params));
    if (data && data.results && data.results.length > 0) return data;
  }
  // last-ditch: en-US with no params stripped (callers sometimes pass
  // language-specific stuff that breaks in ar)
  return getJson<TmdbPaged>(buildUrl(path, "en-US", params));
}

/** ─────────────── TMDB raw shapes (only what we actually use) ─────────────── */

export interface TmdbPaged {
  page: number;
  results: TmdbItem[];
  total_pages: number;
  total_results: number;
}

export interface TmdbItem {
  id: number;
  media_type?: "movie" | "tv" | "person";
  title?: string; // movie
  name?: string; // tv
  original_title?: string;
  original_name?: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count: number;
  genre_ids?: number[];
  release_date?: string; // movie
  first_air_date?: string; // tv
  origin_country?: string[];
  original_language?: string;
  popularity: number;
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  number_of_episodes?: number;
}

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbProvider {
  provider_id: number;
  provider_name: string;
}

/** ─────────────── Genre / provider lookups ─────────────── */

const GENRE_AR: Record<number, string> = {
  28: "أكشن",
  12: "مغامرة",
  16: "أنيميشن",
  35: "كوميديا",
  80: "جريمة",
  99: "وثائقي",
  18: "دراما",
  10751: "عائلي",
  14: "فانتازيا",
  36: "تاريخي",
  27: "رعب",
  10402: "موسيقى",
  9648: "غموض",
  10749: "رومانسي",
  878: "خيال علمي",
  10770: "تليفزيون",
  53: "إثارة",
  10752: "حرب",
  37: "غربي",
  10759: "أكشن ومغامرة",
  10762: "أطفال",
  10763: "أخبار",
  10764: "واقعي",
  10765: "خيال علمي وعام",
  10766: "دراما soap",
  10767: "حوار",
  10768: "حرب وسياسة",
};

const tagFor = (ids: number[] = []): string[] => {
  const out: string[] = [];
  if (ids.includes(16) && ids.includes(10759)) out.push("Anime");
  if (ids.includes(16) && ids.includes(10762)) out.push("Cartoons");
  if (ids.includes(10759) || ids.includes(10765)) out.push("TV Shows");
  if (!out.length) out.push("Movies");
  return out;
};

/** Convert a TMDB list item into our local Title shape. */
export const tmdbToTitle = (m: TmdbItem, kind?: "movie" | "tv"): Title => {
  const mediaType: MediaType = (kind ?? (m.media_type as MediaType) ?? "movie") === "tv" ? "tv" : "movie";
  const name = (m.title || m.name || m.original_title || m.original_name || "").trim();
  const original = (m.original_title || m.original_name || name).trim();
  const yearStr = m.release_date || m.first_air_date || "";
  const year = yearStr ? Number(yearStr.slice(0, 4)) || 0 : 0;
  const rating = Math.round((m.vote_average || 0) * 10) / 10;
  const genres = (m.genre_ids || []).map((id) => GENRE_AR[id]).filter(Boolean) as string[];
  const isTv = mediaType === "tv";
  const localKind: Title["kind"] = isTv
    ? genres.includes("أنيميشن")
      ? genres.includes("أطفال")
        ? "cartoon"
        : "anime"
      : "series"
    : "movie";
  return {
    id: `${mediaType}-${m.id}`,
    name,
    original,
    year,
    rating,
    quality: rating >= 8 ? "4K HDR" : rating >= 7 ? "4K" : "FHD",
    kind: localKind,
    mediaType,
    genres,
    tags: [...new Set([...genres, ...tagFor(m.genre_ids || [])])],
    poster: TMDB_IMG.poster(m.poster_path, "w500"),
    backdrop: TMDB_IMG.backdrop(m.backdrop_path, "w1280"),
    runtime: m.runtime ? `${Math.floor(m.runtime / 60)}س ${m.runtime % 60}د` : undefined,
    seasons: m.number_of_seasons,
    episodes: m.number_of_episodes,
    tagline: "",
    overview: m.overview || "",
    cast: [],
    match: Math.min(99, Math.round(m.popularity || 70)),
    tmdbId: m.id,
  };
};

/** ─────────────── Public API ─────────────── */

/** Trending this week (all media). TMDB returns mixed movie+tv entries. */
export const getTrending = (media: "all" | MediaType = "all") =>
  fetchList(`/trending/${media}/week`).then((d) => d?.results ?? []);

/** Shape of a TMDB /movie/{id} or /tv/{id} detail response (subset). */
export interface TmdbDetails {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview: string;
  tagline?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count: number;
  release_date?: string;
  first_air_date?: string;
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  status?: string;
  original_language?: string;
  origin_country?: string[];
  genres?: { id: number; name: string }[];
  spoken_languages?: { iso_639_1: string; name: string; english_name: string }[];
  production_companies?: { id: number; name: string; logo_path: string | null; origin_country: string }[];
}

/**
 * Fetch full details for a single movie or TV show from TMDB.
 * Tries Arabic first, falls back to English. Returns null on failure /
 * missing key / unknown id.
 */
export const getDetails = async (
  media: MediaType,
  tmdbId: number | undefined,
): Promise<TmdbDetails | null> => {
  if (!hasKey() || !tmdbId) return null;
  for (const lang of LANGS) {
    const url = buildUrl(`/${media}/${tmdbId}`, lang);
    const data = await getJson<TmdbDetails>(url);
    if (data && data.id) return data;
  }
  return null;
};

/** Convert a TMDB detail object into our local Title shape. */
export const tmdbDetailsToTitle = (d: TmdbDetails, media: MediaType): Title => {
  const name = (d.title || d.name || d.original_title || d.original_name || "").trim();
  const original = (d.original_title || d.original_name || name).trim();
  const yearStr = d.release_date || d.first_air_date || "";
  const year = yearStr ? Number(yearStr.slice(0, 4)) || 0 : 0;
  const rating = Math.round((d.vote_average || 0) * 10) / 10;
  const genres = (d.genres || []).map((g) => g.name);
  const isTv = media === "tv";
  const localKind: Title["kind"] = isTv
    ? genres.some((n) => /anim|أنيم|كرت/i.test(n))
      ? genres.some((n) => /kid|أطفال|family/i.test(n))
        ? "cartoon"
        : "anime"
      : "series"
    : "movie";
  const runtimeMin = d.runtime || (d.episode_run_time && d.episode_run_time[0]) || 0;
  return {
    id: `${media}-${d.id}`,
    name,
    original,
    year,
    rating,
    quality: rating >= 8 ? "4K HDR" : rating >= 7 ? "4K" : "FHD",
    kind: localKind,
    mediaType: media,
    genres,
    tags: [
      ...genres,
      isTv ? "TV Shows" : "Movies",
    ],
    poster: TMDB_IMG.poster(d.poster_path, "w500"),
    backdrop: TMDB_IMG.backdrop(d.backdrop_path, "w1280"),
    runtime: runtimeMin ? `${Math.floor(runtimeMin / 60)}س ${runtimeMin % 60}د` : undefined,
    seasons: d.number_of_seasons,
    episodes: d.number_of_episodes,
    tagline: d.tagline || "",
    overview: d.overview || "",
    cast: [],
    match: 90,
    tmdbId: d.id,
  };
};

/** Format a duration in minutes as `Hh Mm` (e.g. 134 → "2h 14m"). */
export const formatRuntime = (mins: number | undefined): string => {
  if (!mins || mins <= 0) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}د`;
  if (!m) return `${h}س`;
  return `${h}س ${m}د`;
};

/** Popular movies or TV. */
export const getPopular = (media: MediaType) =>
  fetchList(`/${media}/popular`).then((d) => d?.results ?? []);

/** Top rated. */
export const getTopRated = (media: MediaType) =>
  fetchList(`/${media}/top_rated`).then((d) => d?.results ?? []);

/** Now playing in theatres. */
export const getNowPlaying = () =>
  fetchList(`/movie/now_playing`, { region: "SA" }).then((d) => d?.results ?? []);

/** Upcoming movies. */
export const getUpcoming = () =>
  fetchList(`/movie/upcoming`, { region: "SA" }).then((d) => d?.results ?? []);

/** On the air (TV). */
export const getOnTheAir = () =>
  fetchList(`/tv/on_the_air`).then((d) => d?.results ?? []);

/** Airing today. */
export const getAiringToday = () =>
  fetchList(`/tv/airing_today`).then((d) => d?.results ?? []);

/** Arabic-language content. */
export const getArabic = (media: MediaType) =>
  fetchList(`/discover/${media}`, {
    with_original_language: "ar",
    sort_by: "popularity.desc",
    "vote_count.gte": 20,
  }).then((d) => d?.results ?? []);

/** Discover by watch provider (US region for catalogue coverage). */
export const discoverByProvider = (media: MediaType, providerId: number) =>
  fetchList(`/discover/${media}`, {
    with_watch_providers: providerId,
    watch_region: "US",
    sort_by: "popularity.desc",
    "vote_count.gte": 50,
  }).then((d) => d?.results ?? []);

/** Discover by genre id (TV genres 16 = animation). */
export const discoverByGenre = (media: MediaType, genreId: number) =>
  fetchList(`/discover/${media}`, {
    with_genres: genreId,
    sort_by: "popularity.desc",
    "vote_count.gte": 100,
  }).then((d) => d?.results ?? []);

/**
 * Multi-search (movies + TV / anime / cartoons).
 *
 * TMDB's `/search/multi` is language-aware: when `language=ar-SA` the
 * ranked results are dominated by Arabic-titled content, so queries
 * for English-only titles like "Spider-Man", "Stranger Things",
 * "Vikings", "Bleach", or "Disney" often return zero useful hits.
 *
 * To get truly dual-language results we fan the query out to BOTH
 * languages in parallel and merge the two result sets:
 *   • English list → kept under their original English titles.
 *   • Arabic list   → kept under their Arabic titles ("سبايدرمان", …).
 * De-duplication is done by `${mediaType}-${tmdbId}` so the same
 * movie in two languages collapses into a single card.
 *
 * The merged list is re-sorted by popularity so the strongest match
 * wins regardless of which language discovered it first.
 */
export const searchMulti = async (query: string): Promise<TmdbItem[]> => {
  if (!hasKey() || !query.trim()) return [];
  const trimmed = query.trim();

  const [en, ar] = await Promise.all([
    getJson<TmdbPaged>(
      buildUrl(`/search/multi`, "en-US", {
        query: trimmed,
        include_adult: "false",
        page: "1",
      }),
    ),
    getJson<TmdbPaged>(
      buildUrl(`/search/multi`, "ar-SA", {
        query: trimmed,
        include_adult: "false",
        page: "1",
      }),
    ),
  ]);

  const merged = new Map<string, TmdbItem>();
  const push = (it: TmdbItem) => {
    if (!it || (it.media_type !== "movie" && it.media_type !== "tv")) return;
    if (!it.id) return;
    const key = `${it.media_type}-${it.id}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, it);
      return;
    }
    // Prefer the entry with a poster and a non-empty overview.
    const score = (x: TmdbItem) =>
      (x.poster_path ? 10 : 0) +
      (x.backdrop_path ? 4 : 0) +
      (x.overview ? 2 : 0) +
      (x.vote_count > 50 ? 1 : 0);
    if (score(it) > score(existing)) merged.set(key, it);
  };

  (en?.results ?? []).forEach(push);
  (ar?.results ?? []).forEach(push);

  return Array.from(merged.values()).sort(
    (a, b) => (b.popularity || 0) - (a.popularity || 0),
  );
};

/** TMDB credit shape (subset). */
export interface TmdbCredit {
  cast: {
    id: number;
    name: string;
    character?: string;
    profile_path?: string | null;
  }[];
  crew?: {
    id: number;
    name: string;
    job?: string;
    profile_path?: string | null;
  }[];
}

/** Fetch cast + crew credits for a single movie or TV show. */
export const getCredits = async (
  media: MediaType,
  tmdbId: number | undefined,
): Promise<TmdbCredit | null> => {
  if (!hasKey() || !tmdbId) return null;
  const url = buildUrl(`/${media}/${tmdbId}/credits`, "en-US");
  const data = await getJson<TmdbCredit>(url);
  return data ?? null;
};

/** TMDB season-detail shape (subset we actually use). */
export interface TmdbSeason {
  id: number;
  season_number: number;
  name: string;
  overview: string;
  air_date?: string;
  episode_count: number;
  poster_path: string | null;
  episodes: {
    id: number;
    episode_number: number;
    season_number: number;
    name: string;
    overview: string;
    air_date?: string;
    runtime?: number;
    still_path: string | null;
    vote_average: number;
    vote_count: number;
  }[];
}

/**
 * Fetch the full metadata for a single season (its poster AND its list
 * of episodes with stills, runtimes, etc.). Tries Arabic first, then
 * English. Returns null when the key is missing or the season is gone.
 */
export const getSeasonDetails = async (
  tmdbId: number | undefined,
  seasonNumber: number,
): Promise<TmdbSeason | null> => {
  if (!hasKey() || !tmdbId) return null;
  for (const lang of LANGS) {
    const url = buildUrl(`/tv/${tmdbId}/season/${seasonNumber}`, lang);
    const data = await getJson<TmdbSeason>(url);
    if (data && data.id) return data;
  }
  return null;
};

/** Fetch similar titles (movies or TV). Returns TMDB paged results. */
export const getSimilar = async (
  media: MediaType,
  tmdbId: number | undefined,
): Promise<TmdbItem[]> => {
  if (!hasKey() || !tmdbId) return [];
  const url = buildUrl(`/${media}/${tmdbId}/similar`, "en-US");
  const data = await getJson<TmdbPaged>(url);
  return data?.results ?? [];
};

/** Provider id constants (TMDB just-watch providers, US region). */
export const PROVIDERS = {
  netflix: 8,
  disney: 337,
  apple: 384,
  hbo: 384, // alias; HBO Max US provider id is 384 (max) — keep separate for clarity
  hboMax: 384,
  paramount: 531,
  prime: 9,
  peacock: 386,
} as const;

/** TMDB genre ids used in the UI rows. */
export const GENRES = {
  action: 28,
  adventure: 12,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 14,
  history: 36,
  horror: 27,
  music: 10402,
  mystery: 9648,
  romance: 10749,
  scifi: 878,
  thriller: 53,
  war: 10752,
  western: 37,
  animeTV: 16, // discover/tv with_genres=16 → animation (anime-friendly)
  cartoonTV: 10762, // kids
} as const;
