import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Route =
  | { name: "home" }
  | {
      name: "title";
      id: string;
      /** TMDB media type — drives the embed URL when entering a room. */
      mediaType?: "movie" | "tv";
      /** TMDB numeric id. */
      tmdbId?: number;
    }
  | {
      name: "room";
      id: string;
      /** Stable id of the underlying Title, used for fallback lookup. */
      titleId?: string;
      /** TMDB media type — controls the embed URL shape. */
      mediaType?: "movie" | "tv";
      /** TMDB numeric id. */
      tmdbId?: number;
    };

interface Ctx {
  route: Route;
  navigate: (r: Route) => void;
  back: () => void;
}

const RouterCtx = createContext<Ctx>({
  route: { name: "home" },
  navigate: () => {},
  back: () => {},
});

const parse = (hash: string): Route => {
  const h = hash.replace(/^#\/?/, "");
  const [seg, id, ...rest] = h.split("/");
  if (seg === "title" && id) {
    let mediaType: "movie" | "tv" | undefined;
    let tmdbId: number | undefined;
    for (const part of rest) {
      if (part.startsWith("m=")) mediaType = (part.slice(2) as "movie" | "tv") || undefined;
      else if (part.startsWith("id=")) {
        const n = Number(part.slice(3));
        if (Number.isFinite(n)) tmdbId = n;
      }
    }
    return { name: "title", id, mediaType, tmdbId };
  }
  if (seg === "room") {
    let titleId: string | undefined;
    let mediaType: "movie" | "tv" | undefined;
    let tmdbId: number | undefined;
    for (const part of rest) {
      if (part.startsWith("t=")) titleId = part.slice(2) || undefined;
      else if (part.startsWith("m=")) mediaType = (part.slice(2) as "movie" | "tv") || undefined;
      else if (part.startsWith("id=")) {
        const n = Number(part.slice(3));
        if (Number.isFinite(n)) tmdbId = n;
      }
    }
    return { name: "room", id: id || "RV-8842", titleId, mediaType, tmdbId };
  }
  return { name: "home" };
};

const stringify = (r: Route) => {
  if (r.name === "title") {
    const extras: string[] = [];
    if (r.mediaType) extras.push(`m=${r.mediaType}`);
    if (r.tmdbId) extras.push(`id=${r.tmdbId}`);
    return extras.length ? `#/title/${r.id}/${extras.join("/")}` : `#/title/${r.id}`;
  }
  if (r.name === "room") {
    const extras: string[] = [];
    if (r.titleId) extras.push(`t=${r.titleId}`);
    if (r.mediaType) extras.push(`m=${r.mediaType}`);
    if (r.tmdbId) extras.push(`id=${r.tmdbId}`);
    return extras.length ? `#/room/${r.id}/${extras.join("/")}` : `#/room/${r.id}`;
  }
  return "#/";
};

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() =>
    parse(typeof window === "undefined" ? "" : window.location.hash),
  );

  useEffect(() => {
    const onHash = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((r: Route) => {
    window.location.hash = stringify(r);
    setRoute(r);
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, []);

  const back = useCallback(() => {
    if (window.history.length > 1) window.history.back();
    else navigate({ name: "home" });
  }, [navigate]);

  const value = useMemo(() => ({ route, navigate, back }), [route, navigate, back]);
  return <RouterCtx.Provider value={value}>{children}</RouterCtx.Provider>;
}

export const useRouter = () => useContext(RouterCtx);
