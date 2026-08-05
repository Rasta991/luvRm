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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
