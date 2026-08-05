import type { MediaType } from "./roomSync";

/**
 * Build an absolute, shareable invite URL for a Watch Party room.
 * Includes media path segments when known so guests start playing
 * immediately without waiting for host sync.
 */
export function buildRoomInviteUrl(
  code: string,
  opts?: { mediaType?: MediaType; tmdbId?: number; titleId?: string },
): string {
  const extras: string[] = [];
  const titleId =
    opts?.titleId ??
    (opts?.mediaType && opts?.tmdbId
      ? `${opts.mediaType}-${opts.tmdbId}`
      : undefined);
  if (titleId) extras.push(`t=${titleId}`);
  if (opts?.mediaType) extras.push(`m=${opts.mediaType}`);
  if (opts?.tmdbId) extras.push(`id=${opts.tmdbId}`);
  const hash = extras.length
    ? `#/room/${code}/${extras.join("/")}`
    : `#/room/${code}`;

  if (typeof window === "undefined") {
    return `https://luvinrm.tv/${hash}`;
  }
  return `${window.location.origin}${window.location.pathname}${hash}`;
}

/**
 * Parse `m=` / `id=` from the current location hash — supports both
 * path segments (`#/room/CODE/m=movie/id=603`) and query style
 * (`#/room/CODE?m=movie&id=603`).
 */
export function parseMediaFromHash(
  hash = typeof window !== "undefined" ? window.location.hash : "",
): {
  mediaType?: MediaType;
  tmdbId?: number;
} {
  try {
    const h = hash.replace(/^#\/?/, "");
    let mediaType: MediaType | undefined;
    let tmdbId: number | undefined;

    const pathPart = h.split("?")[0] ?? "";
    for (const part of pathPart.split("/")) {
      if (part.startsWith("m=")) {
        const m = part.slice(2);
        if (m === "movie" || m === "tv") mediaType = m;
      } else if (part.startsWith("id=")) {
        const n = Number(part.slice(3));
        if (Number.isFinite(n) && n > 0) tmdbId = n;
      }
    }

    const queryIdx = hash.indexOf("?");
    if (queryIdx >= 0) {
      const usp = new URLSearchParams(hash.slice(queryIdx + 1));
      const m = usp.get("m");
      const id = usp.get("id");
      if ((m === "movie" || m === "tv") && !mediaType) mediaType = m;
      const idNum = id ? Number(id) : NaN;
      if (Number.isFinite(idNum) && idNum > 0 && !tmdbId) tmdbId = idNum;
    }

    return { mediaType, tmdbId };
  } catch {
    return {};
  }
}
