/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional override for the realtime room server URL. When set, the
   * client will use this WebSocket origin instead of the page's own
   * origin so production deployments can point at a real socket
   * backend. Leave unset in dev to fall back to the current origin.
   */
  readonly VITE_SOCKET_URL?: string;
  /** Supabase project URL — required for cross-device Watch Party sync. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon/public key — required for cross-device Watch Party sync. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** TMDB API key for catalog / details. */
  readonly VITE_TMDB_API_KEY?: string;
  /**
   * Direct HLS stream resolver URL (overrides the same-origin
   * `/api/stream` edge function). Useful for local dev when not
   * running `vercel dev`. Leave unset in production.
   */
  readonly VITE_STREAM_RESOLVER_URL?: string;
  /**
   * Subtitle proxy base URL. Defaults to `/api/subtitles` when unset.
   * The proxy keeps the SubDL key off the client bundle.
   */
  readonly VITE_SUBDL_PROXY_URL?: string;
  /**
   * Direct SubDL API key — only used when `VITE_SUBDL_PROXY_URL` is
   * unset (browser CORS-blocked in production; fine for dev).
   */
  readonly VITE_SUBDL_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
