export type Quality = "HD" | "FHD" | "4K" | "4K HDR" | "DOLBY VISION";
export type Kind = "movie" | "series" | "anime" | "cartoon";
/** "movie" for films, "tv" for series/anime/cartoons — what TMDB calls them. */
export type MediaType = "movie" | "tv";

export interface Title {
  id: string;
  name: string;
  original: string;
  year: number;
  rating: number;
  quality: Quality;
  kind: Kind;
  /** TMDB media type — drives the embed URL. */
  mediaType: MediaType;
  genres: string[];
  tags: string[];
  poster: string;
  backdrop: string;
  runtime?: string;
  seasons?: number;
  episodes?: number;
  parts?: number;
  tagline: string;
  overview: string;
  cast: { name: string; role: string }[];
  match: number;
  /** TMDB id used to build the embed URL (movies / TV). */
  tmdbId?: number;
  /** Optional override; when present, the player uses this URL directly. */
  embedUrl?: string;
}

/**
 * Static fallback catalog — intentionally EMPTY. The catalog is now
 * powered by TMDB (`src/lib/tmdb.ts`). Components that still reference
 * TITLES (search filter, Top10, ROWS) degrade gracefully to an empty
 * array, so nothing crashes while the API hydrates.
 *
 * Keeping an empty array here also lets us drop the legacy mock strings
 * ("Violet Requiem", "Neon Serpent", "Starlight Diner", …) without
 * breaking any imports or type signatures.
 */
export const TITLES: Title[] = [];

export const byId = (id: string) => TITLES.find((t) => t.id === id);

export interface Row {
  key: string;
  title: string;
  subtitle: string;
  items: Title[];
}

/**
 * Static ROWS list — kept as an empty shell. The Home page now builds
 * its rows dynamically from TMDB (`src/pages/Home.tsx`); we keep the
 * `ROWS` export so legacy imports don't crash, but the items arrays are
 * empty.
 */
export const ROWS: Row[] = [];

export const TOP10: Title[] = [];

export interface Channel {
  id: string;
  name: string;
  tag: string;
  from: string;
  to: string;
  mark: string;
}

/**
 * Branding-only fixtures. These don't contain mock titles — just the
 * app's "channels" branding rows used on the Home page footer.
 */
export const CHANNELS: Channel[] = [
  { id: "c1", name: "Lumina+", tag: "أصلي حصري", from: "#7C3AED", to: "#A855F7", mark: "L+" },
  { id: "c2", name: "Nova Play", tag: "أفلام ٢٠٢٥", from: "#3B0764", to: "#A855F7", mark: "N" },
  { id: "c3", name: "Orbit TV", tag: "بث مباشر", from: "#1E1B4B", to: "#6D28D9", mark: "O" },
  { id: "c4", name: "Zenith", tag: "وثائقيات 4K", from: "#4C1D95", to: "#C084FC", mark: "Z" },
  { id: "c5", name: "Kōra", tag: "أنمي بلا حدود", from: "#581C87", to: "#E879F9", mark: "K" },
  { id: "c6", name: "Pulse Sports", tag: "رياضة حيّة", from: "#0F172A", to: "#7C3AED", mark: "P" },
  { id: "c7", name: "Mosaic", tag: "دراما عربية", from: "#2E1065", to: "#A78BFA", mark: "M" },
  { id: "c8", name: "Kiddo", tag: "أطفال آمن", from: "#6D28D9", to: "#F0ABFC", mark: "K+" },
];