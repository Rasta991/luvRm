/**
 * Lazy hls.js loader.
 *
 * We pull hls.js from a pinned jsDelivr CDN URL so we don't have to ship a
 * npm dependency (which conflicts with our React 19 + Vidstack peer-dep
 * mess). The script is loaded once and cached on `window`.
 *
 * Why CDN and not npm?
 *  - `@vidstack/react@0.6.x` is pinned to `@types/react@^18`. React 19 is
 *    installed. Installing `hls.js` next to that triggers peer-dep errors.
 *  - hls.js is a single-purpose library; shipping a CDN script tag is
 *    fine for the browser-only use case here.
 *  - The script is small (~140 KB gz) and is only fetched the first time
 *    the player actually encounters an .m3u8 source.
 */

const HLS_VERSION = "1.5.20";
const HLS_URL = `https://cdn.jsdelivr.net/npm/hls.js@${HLS_VERSION}/dist/hls.min.js`;

declare global {
  interface Window {
    Hls?: typeof import("hls.js").default;
  }
}

let loadingPromise: Promise<typeof window.Hls | null> | null = null;

/** Load hls.js from CDN exactly once; resolves to the Hls constructor. */
export function loadHls(): Promise<typeof window.Hls | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.Hls) return Promise.resolve(window.Hls);
  if (loadingPromise) return loadingPromise;
  loadingPromise = new Promise((resolve) => {
    // If the user already has Hls.js on the page (e.g. from a previous
    // mount that hasn't been cleaned up), reuse it.
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-hls="${HLS_VERSION}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Hls ?? null), { once: true });
      existing.addEventListener("error", () => resolve(null), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = HLS_URL;
    s.async = true;
    s.defer = true;
    s.dataset.hls = HLS_VERSION;
    s.addEventListener(
      "load",
      () => {
        resolve(window.Hls ?? null);
      },
      { once: true },
    );
    s.addEventListener("error", () => resolve(null), { once: true });
    document.head.appendChild(s);
  });
  return loadingPromise;
}

/** True when the browser plays HLS natively (Safari, iOS, a few smart TVs). */
export function supportsNativeHls(): boolean {
  if (typeof document === "undefined") return false;
  const v = document.createElement("video");
  return v.canPlayType("application/vnd.apple.mpegurl") !== "";
}
