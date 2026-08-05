import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Ban,
  Check,
  Copy,
  Crown,
  FastForward,
  Film,
  Link2,
  Loader2,
  MessageSquare,
  MoreVertical,
  Pause,
  Play,
  Rewind,
  Send,
  ShieldOff,
  Smile,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button } from "../components/ui/Primitives";
import { EpisodeChip, EpisodePicker } from "../components/EpisodePicker";
import { VideoPlayer, type SubtitleTrack } from "../components/VideoPlayer";
import { type MediaType, type Title } from "../data/catalog";
import { useRoomSync } from "../hooks/useRoomSync";
import { buildRoomInviteUrl, parseMediaFromHash } from "../lib/inviteUrl";
import { useRouter } from "../lib/router";
import type { RoomMediaState } from "../lib/roomSync";
import { readRoomState } from "../lib/roomSync";
import {
  formatRuntime,
  getDetails,
  tmdbDetailsToTitle,
  type TmdbDetails,
} from "../lib/tmdb";
import { fetchArabicSubtitle } from "../lib/subtitles";
import { fetchDirectStreamUrl } from "../lib/stream";
import { cn } from "../utils/cn";

/* ───────────────────────────  Stream source  ─────────────────────────── */

// Fallback stream rendered while the resolver is in-flight. The
// `fetchDirectStreamUrl` helper has its own fallback, but we seed the
// state with one so the very first render of <VideoPlayer /> always
// receives a non-empty `streamUrl` prop.
const FALLBACK_STREAM =
  "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

/**
 * Arabic subtitle track(s) passed straight to <VideoPlayer />.
 *
 * Host the .vtt file on your own origin (e.g. /public/subtitles/... or
 * a Supabase Storage object) so the player can fetch it cross-origin
 * with the same CORS policy as the manifest. Pointing this at a pirate
 * host's CDN will get you a 404 or worse.
 */
const ARABIC_SUBTITLES: SubtitleTrack[] = [
  {
    lang: "ar",
    label: "العربية",
    file: "/subtitles/arabic.vtt",
    default: true,
  },
];

const EMOJIS = ["🔥", "😂", "😍", "🍿", "👏", "😱", "💜", "🎬"];

const SEEK_STEP_S = 20;

const formatTime = (ms: number) =>
  new Date(ms).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });

const formatClock = (s: number) => {
  const total = Math.max(0, Math.floor(s));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

/* ───────────────────────────  Component  ─────────────────────────── */

export function RoomPage({
  code,
  titleId,
  mediaType: routeMediaType,
  tmdbId: routeTmdbId,
}: {
  code: string;
  titleId?: string;
  mediaType?: MediaType;
  tmdbId?: number;
}) {
  const { back, navigate } = useRouter();

  const {
    members,
    messages,
    hostState,
    mediaState,
    ready,
    sendMessage,
    broadcastPlay,
    broadcastPause,
    broadcastSeek,
    broadcastEpisode,
    broadcastMedia,
    persistRoomState,
    sendHeartbeat,
    togglePlay,
    seek,
    resync,
    requestMedia,
    requestHostState,
    kick,
    ban,
    transferHost,
    kicked,
    canControlRoom,
  } = useRoomSync(code);

  // ── If the host kicked us, drop out of the room immediately. ──
  useEffect(() => {
    if (kicked) navigate({ name: "home" });
  }, [kicked, navigate]);

  /* ----------  Resolve the active media ---------- */
  // Priority order:
  //   1. Instant hash/query parse (`m=` / `id=`) so invite links start
  //      playing immediately without "Waiting for Host Data".
  //   2. The room's broadcast `mediaState` (authoritative for bare joins).
  //   3. The route's explicit `mediaType` / `tmdbId`.
  //   4. The composite `titleId` ("tv-1399") if it parses.
  //   5. Empty fallback (→ loader until host answers).
  const urlParams = parseMediaFromHash(
    typeof window === "undefined" ? "" : window.location.hash,
  );

  const initialMediaType: MediaType =
    urlParams.mediaType ??
    routeMediaType ??
    (mediaState?.mediaType as MediaType | undefined) ??
    (titleId?.startsWith("tv-") ? "tv" : "movie");
  const initialTmdbId =
    urlParams.tmdbId ??
    routeTmdbId ??
    mediaState?.tmdbId ??
    0;
  const initialTitleId =
    titleId ?? `${initialMediaType}-${initialTmdbId || 0}`;

  // Live state mirrors `mediaState` when one arrives. Local-only writes
  // are also reflected here so the host's UI is responsive while the
  // round-trip settles.
  const [mediaType, setMediaType] = useState<MediaType>(initialMediaType);
  const [tmdbId, setTmdbId] = useState<number>(initialTmdbId);
  const [resolvedFromSync, setResolvedFromSync] = useState<boolean>(!!mediaState);

  // When the room's media state arrives, mirror it into local state.
  useEffect(() => {
    if (!mediaState) return;
    if (!mediaState.tmdbId) return;
    setMediaType(mediaState.mediaType);
    setTmdbId(mediaState.tmdbId);
    setResolvedFromSync(true);
  }, [mediaState]);

  const [details, setDetails] = useState<TmdbDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState<boolean>(!!tmdbId);
  // Subtitle fetched from SubDL (TMDB → IMDb → SubDL → SRT/VTT).
  // `null` means "not yet attempted" or "no key configured" — both
  // are fine; the static `ARABIC_SUBTITLES` entry remains as a fallback.
  const [arabicSubtitle, setArabicSubtitle] = useState<SubtitleTrack | null>(null);
  const [serverIdx, setServerIdx] = useState(0);
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"chat" | "members">("chat");
  const [showEmoji, setShowEmoji] = useState(false);
  const [modFor, setModFor] = useState<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const playerWrapRef = useRef<HTMLDivElement>(null);

  // Mobile landscape lock when the player (or document) enters fullscreen.
  useEffect(() => {
    const lockLandscape = () => {
      const orient = screen.orientation as ScreenOrientation & {
        lock?: (orientation: string) => Promise<void>;
      };
      void orient?.lock?.("landscape")?.catch(() => {});
    };
    const onFs = () => {
      const fs =
        document.fullscreenElement ||
        (document as Document & { webkitFullscreenElement?: Element })
          .webkitFullscreenElement;
      if (fs) lockLandscape();
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener(
        "webkitfullscreenchange",
        onFs as EventListener,
      );
    };
  }, []);

  // Title fallback (used until TMDB resolves).
  const fallbackTitle: Title = {
    id: initialTitleId,
    name: "غرفة مشاهدة",
    original: "",
    year: 0,
    rating: 0,
    quality: "FHD",
    kind: mediaType === "tv" ? "series" : "movie",
    mediaType,
    genres: [],
    tags: [],
    poster: "",
    backdrop: "",
    overview: "",
    tagline: "",
    cast: [],
    match: 0,
    tmdbId,
  };

  /* ----------  Fetch TMDB details  ---------- */
  useEffect(() => {
    if (!tmdbId) {
      setDetailsLoading(false);
      return;
    }
    let cancelled = false;
    setDetailsLoading(true);
    getDetails(mediaType, tmdbId)
      .then((d) => {
        if (cancelled) return;
        setDetails(d);
      })
      .catch(() => {
        if (cancelled) return;
        setDetails(null);
      })
      .finally(() => {
        if (cancelled) return;
        setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mediaType, tmdbId]);

  /* ----------  Fetch Arabic subtitle from SubDL ---------- */
  // Fires once per `(tmdbId, mediaType)` pair. The function does its
  // own IMDB resolution + SubDL lookup + SRT→VTT conversion; if any
  // step fails, we keep the static fallback (`ARABIC_SUBTITLES`) in
  // `subtitles` below.
  useEffect(() => {
    if (!tmdbId) return;
    let cancelled = false;
    fetchArabicSubtitle(tmdbId, mediaType)
      .then((track) => {
        if (cancelled) return;
        setArabicSubtitle(track);
      })
      .catch(() => {
        if (cancelled) return;
        setArabicSubtitle(null);
      });
    return () => {
      cancelled = true;
    };
  }, [mediaType, tmdbId]);

  /* ----------  Per-title HLS stream URL ---------- */
  // Resolved asynchronously via `fetchDirectStreamUrl`, which:
  //   1. Returns the host-provided `customStreamUrl` immediately if any.
  //   2. Otherwise calls `/api/stream` (edge function reading
  //      `STREAM_RESOLVER_URL`).
  //   3. Falls back to the Mux test stream on any failure.
  //
  // We seed the state with the fallback so the first <VideoPlayer />
  // render always gets a non-empty `streamUrl`. The effect below
  // upgrades it as soon as the resolver responds.
  const [streamUrl, setStreamUrl] = useState<string>(FALLBACK_STREAM);
  useEffect(() => {
    let cancelled = false;
    fetchDirectStreamUrl({
      tmdbId,
      mediaType,
      season,
      episode,
      customStreamUrl: mediaState?.customStreamUrl ?? null,
    }).then((url) => {
      if (cancelled) return;
      if (url) setStreamUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [tmdbId, mediaType, season, episode, mediaState?.customStreamUrl]);

  /* ----------  Derived active title  ---------- */
  const movie: Title = useMemo(() => {
    if (details) return tmdbDetailsToTitle(details, mediaType);
    return fallbackTitle;
  }, [details, mediaType, fallbackTitle]);

  // Re-seed season/episode / server when the loaded media changes.
  useEffect(() => {
    setSeason(1);
    setEpisode(1);
    setServerIdx(0);
  }, [tmdbId, mediaType]);

  // Mirror Host's server index on both sides (parity for joiners).
  useEffect(() => {
    if (!mediaState) return;
    if (mediaState.serverIdx !== serverIdx) setServerIdx(mediaState.serverIdx);
    if (mediaState.season !== season) setSeason(mediaState.season);
    if (mediaState.episode !== episode) setEpisode(mediaState.episode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaState?.serverIdx, mediaState?.season, mediaState?.episode, tmdbId]);

  // Non-host members also mirror the host's current (season, episode)
  // from `playback:state` for parity (older stream of truth). Solo
  // viewers and hosts already have authoritative local state, so
  // they skip this effect.
  useEffect(() => {
    if (canControlRoom) return;
    if (!hostState) return;
    if (mediaType !== "tv") return;
    if (hostState.season !== season || hostState.episode !== episode) {
      setSeason(hostState.season);
      setEpisode(hostState.episode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canControlRoom, hostState?.season, hostState?.episode, mediaType]);

  /* ----------  Auto-scroll chat ---------- */
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, tab]);

  // ── Host broadcasts media state on every change so joiners latch on
  //    instantly. The broadcast is debounced through a ref to coalesce
  //    rapid bursts (e.g. spinner / TMDB swap). Gated on
  //    `canControlRoom` so a solo viewer always broadcasts their
  //    changes immediately, even before the host-election finishes.
  const lastBroadcastRef = useRef<string>("");
  useEffect(() => {
    if (!canControlRoom) return;
    if (!tmdbId) return;
    const sig = `${tmdbId}|${mediaType}|${season}|${episode}|${serverIdx}`;
    if (sig === lastBroadcastRef.current) return;
    lastBroadcastRef.current = sig;
    const next: RoomMediaState = {
      titleId: `${mediaType}-${tmdbId}`,
      tmdbId,
      mediaType,
      season,
      episode,
      serverIdx,
      currentTime: hostState?.time ?? 0,
      ts: Date.now(),
    };
    broadcastMedia(next);
  }, [canControlRoom, tmdbId, mediaType, season, episode, serverIdx, broadcastMedia, hostState?.time]);

  // ── Quietly update the browser URL so a joiner who arrived bare
  //    (`/room/RV-XXXX`) ends up at a shareable `/room/RV-XXXX/...`
  //    matching the host's session. Uses `history.replaceState` so we
  //    don't grow the back-button stack.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!tmdbId) return;
    const compositeId = `${mediaType}-${tmdbId}`;
    const desired = `#/room/${code}/t=${compositeId}/m=${mediaType}/id=${tmdbId}`;
    if (window.location.hash === desired) return;
    try {
      window.history.replaceState(null, "", desired);
    } catch {
      // private mode / restricted env — silently ignore
    }
  }, [code, tmdbId, mediaType]);

  // ── On mount, ask the host for media state if we don't have it.
  //    Cheap belt-and-braces to the roomSync layer that already does
  //    this automatically — covers the case where the host's seed
  //    broadcast raced ahead of our connect. Also fire the
  //    dual-sync `requestHostState` so the joiner can mount the
  //    iframe from the host's self-contained payload, without
  //    blocking on the heavier media:state round-trip.
  useEffect(() => {
    // A solo viewer (or elected host) is the authority — no need to
    // ask themselves for state. Skip when canControlRoom.
    if (canControlRoom) return;
    if (resolvedFromSync) return;
    requestMedia();
    requestHostState();
    const t = setTimeout(() => requestMedia(), 600);
    const t2 = setTimeout(() => requestMedia(), 1500);
    const t3 = setTimeout(() => requestHostState(), 600);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
      clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canControlRoom, resolvedFromSync]);

  // ── INSTANT JOINER HANDSHAKE: synchronously read the host's
  //    persisted snapshot from localStorage so a joiner who lands at
  //    `/room/RV-XXXX` (no other params) gets `tmdbId`/`mediaType`/
  //    `season`/`episode`/server BEFORE the first BroadcastChannel
  //    round-trip resolves. This is the <200ms critical path.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (resolvedFromSync) return;
    const cached = readRoomState(code);
    if (!cached) return;
    if (!cached.tmdbId) return;
    setMediaType(cached.mediaType);
    setTmdbId(cached.tmdbId);
    if (typeof cached.season === "number" && cached.season > 0) setSeason(cached.season);
    if (typeof cached.episode === "number" && cached.episode > 0) setEpisode(cached.episode);
    if (typeof cached.serverIdx === "number") setServerIdx(cached.serverIdx);
    setResolvedFromSync(true);
    // Quietly update the URL to match the resolved session.
    const compositeId = `${cached.mediaType}-${cached.tmdbId}`;
    const desired = `#/room/${code}/t=${compositeId}/m=${cached.mediaType}/id=${cached.tmdbId}`;
    if (window.location.hash !== desired) {
      try {
        window.history.replaceState(null, "", desired);
      } catch {
        /* ignore */
      }
    }
  }, [code, resolvedFromSync]);

  // ── HOST: keep the persisted snapshot fresh on every media change
  //    so a joiner who opens the room *right after* a server switch
  //    still finds the new state in localStorage. Gated on
  //    `canControlRoom` so a solo viewer always persists their
  //    session state, even before the host-election finishes.
  useEffect(() => {
    if (!canControlRoom) return;
    if (!tmdbId) return;
    const next: RoomMediaState = {
      titleId: `${mediaType}-${tmdbId}`,
      tmdbId,
      mediaType,
      season,
      episode,
      serverIdx,
      currentTime: hostState?.time ?? 0,
      ts: Date.now(),
    };
    persistRoomState(next);
  }, [canControlRoom, tmdbId, mediaType, season, episode, serverIdx, hostState?.time, persistRoomState]);

  // ── DRIFT CORRECTION NOTE: non-host peers render the iframe whose
  //    `key` already depends on `hostState.time` and `hostState.ts`.
  //    When the host broadcasts a new heartbeat that crosses our 3s
  //    tolerance, `hostState` updates in place via `useRoomSync`, and
  //    React remounts the iframe with a fresh `src` that reflects the
  //    new play/pause state and timestamp. The `useRoomSync` layer
  //    already handles the low-level `heartbeat` event — we don't
  //    need a second listener here.

  /* ----------  Handlers ---------- */
  const send = () => {
    if (!draft.trim()) return;
    sendMessage(draft);
    setDraft("");
  };

  const copy = (what: "code" | "link") => {
    const text =
      what === "code"
        ? code
        : buildRoomInviteUrl(code, {
            mediaType,
            tmdbId: tmdbId || undefined,
            titleId: tmdbId ? `${mediaType}-${tmdbId}` : undefined,
          });
    navigator.clipboard?.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1800);
  };

  /** Host playback controls. Always broadcast to peers. */
  const onHostPlay = () => {
    if (!canControlRoom) return;
    const t = hostState?.time ?? 0;
    broadcastPlay(t);
    togglePlay(t);
    sendHeartbeat(t, true);
  };
  const onHostPause = () => {
    if (!canControlRoom) return;
    const t = hostState?.time ?? 0;
    broadcastPause(t);
    togglePlay(t);
    sendHeartbeat(t, false);
  };
  const onHostSeek = (delta: number) => {
    if (!canControlRoom) return;
    const next = Math.max(0, (hostState?.time ?? 0) + delta);
    broadcastSeek(next);
    seek(next);
    sendHeartbeat(next, hostState?.playing ?? false);
  };

  /* ----------  Render-time helpers  ---------- */
  const genres = movie.genres?.length ? movie.genres.join(" · ") : "—";
  const synopsis = movie.overview || movie.tagline || "لا يتوفر وصف لهذا المحتوى بعد.";
  const roomTitle = movie.name && movie.name !== "غرفة مشاهدة" ? movie.name : `غرفة ${code}`;
  const roomSubtitle = `${movie.original || ""}${movie.original && movie.year ? " · " : ""}${
    movie.year || ""
  }`.trim();
  const memberCount = Math.max(members.length, 1);
  const hostTime = hostState?.time ?? 0;
  const playing = hostState?.playing ?? false;
  // The first member with isHost=true is the canonical host.
  const canonicalHostId = members.find((m) => m.isHost)?.id;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="mx-auto flex w-full min-h-screen max-w-[1800px] flex-col overflow-x-hidden px-3 pb-10 pt-20 sm:px-6 lg:px-10 lg:pt-24"
    >
      {/* room header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={back}
            className="glass grid size-10 place-items-center rounded-full text-white/80 transition hover:text-white"
          >
            <ArrowRight className="size-5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="pulse-dot size-2 rounded-full bg-emerald-400" />
              <h1 className="truncate font-display text-lg font-extrabold text-white sm:text-xl">
                {roomTitle}
              </h1>
              <Badge tone="brand">LIVE</Badge>
              {canControlRoom && (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-gradient-to-l from-[#A855F7] to-[#7C3AED] px-2 py-[2px] text-[10px] font-black text-white">
                  <Crown className="size-3" /> المضيف
                </span>
              )}
              {detailsLoading && (
                <Loader2 className="size-3.5 animate-spin text-white/45" />
              )}
            </div>
            <p className="mt-0.5 truncate text-[12px] text-white/45">
              {roomSubtitle || (canControlRoom ? "أنت المضيف" : "يستضيفها آخر")} · {memberCount} {memberCount === 1 ? "عضو" : "أعضاء"} ·
              {" "}
              {canControlRoom ? "المضيف" : playing ? "يُبث الآن" : "متزامن"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="glass flex items-center gap-2 rounded-full px-3 py-2">
            <span className="text-[11px] text-white/45">الكود</span>
            <span className="font-display text-[13px] font-black tracking-[0.2em] text-white">
              {code}
            </span>
            <button
              onClick={() => copy("code")}
              className="text-white/60 transition hover:text-brand"
            >
              {copied === "code" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          </div>
          <Button size="sm" variant="glass" onClick={() => copy("link")}>
            {copied === "link" ? <Check className="size-4" /> : <Link2 className="size-4" />}
            {copied === "link" ? "تم نسخ الرابط" : "نسخ الرابط"}
          </Button>
          <Button size="sm" onClick={() => navigate({ name: "home" })}>
            مغادرة الغرفة
          </Button>
        </div>
      </div>

      {/* Mobile-first stacked layout: player on top (order-1), chat/members
          below (order-2). On lg+ (≥1024px) side-by-side grid. */}
      <div className="flex w-full min-h-screen flex-col gap-4 lg:min-h-0 lg:grid lg:grid-cols-[3fr_7fr]">
        {/* ---------- player ---------- */}
        <div className="order-1 w-full space-y-4 lg:order-2">
          {/* Meta row: episode chip + host playback cluster + sync chip. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-surface/60 px-4 py-3 backdrop-blur">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold text-white">{roomTitle}</p>
              <p className="truncate text-[12px] text-white/55">{roomSubtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {mediaType === "tv" && (
                <EpisodeChip
                  season={season}
                  episode={episode}
                  disabled={!canControlRoom}
                  onClick={() => setPickerOpen(true)}
                />
              )}

              {/* Inline host playback cluster. Non-hosts see a read-only
                  sync badge instead, but it sits on the SAME row as the
                  episode chip — no second toolbar above the iframe. */}
              {canControlRoom ? (
                <div className="flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/[0.07] p-1">
                  <button
                    onClick={() => onHostSeek(-SEEK_STEP_S)}
                    className="grid size-8 place-items-center rounded-full text-amber-100 transition hover:bg-amber-400/20"
                    title={`ارجع ${SEEK_STEP_S} ثانية`}
                  >
                    <Rewind className="size-4" />
                  </button>
                  {playing ? (
                    <button
                      onClick={onHostPause}
                      className="grid size-9 place-items-center rounded-full bg-white text-black shadow-lg transition hover:scale-105"
                      title="إيقاف مؤقت"
                    >
                      <Pause className="size-4 fill-current" />
                    </button>
                  ) : (
                    <button
                      onClick={onHostPlay}
                      className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg transition hover:scale-105"
                      title="تشغيل"
                    >
                      <Play className="size-4 fill-current" />
                    </button>
                  )}
                  <button
                    onClick={() => onHostSeek(SEEK_STEP_S)}
                    className="grid size-8 place-items-center rounded-full text-amber-100 transition hover:bg-amber-400/20"
                    title={`تقدّم ${SEEK_STEP_S} ثانية`}
                  >
                    <FastForward className="size-4" />
                  </button>
                  <span className="me-2 ms-1 font-mono text-[11px] text-amber-100/90">
                    {formatClock(hostTime)}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-full border border-brand/30 bg-brand/[0.08] px-3 py-1.5 text-[11px] text-white/80">
                  <span className="size-1.5 rounded-full bg-brand" />
                  متزامن مع المضيف · {formatClock(hostTime)}
                  <button
                    onClick={resync}
                    className="rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[10.5px] text-white/70 transition hover:border-brand/50 hover:text-white"
                    title="اطلب لقطة جديدة من المضيف"
                  >
                    إعادة التزامن
                  </button>
                </div>
              )}

              <div className="glass hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] text-white/80 sm:flex">
                <span className="pulse-dot size-1.5 rounded-full bg-emerald-400" />
                مشاهدة متزامنة
              </div>
            </div>
          </div>

          {/* The video player container. NO pointer-events for non-hosts
              so they cannot manually desync the room. The wrapper
              itself stays `pointer-events: auto` for the host (or for
              a solo viewer, who has full host control) so the embed's
              native UI is interactive. */}
          <div
            ref={playerWrapRef}
            className="relative aspect-video w-full overflow-hidden rounded-3xl border border-white/[0.08] bg-black shadow-[0_30px_90px_-40px_rgba(168,85,247,0.7)]"
            style={{ pointerEvents: canControlRoom ? "auto" : "none" }}
          >
            <VideoPlayer
              key={`${tmdbId}-${season}-${episode}-${streamUrl}`}
              streamUrl={streamUrl}
              title={roomTitle}
              subtitles={
                arabicSubtitle
                  ? [arabicSubtitle, ...ARABIC_SUBTITLES.map((s) => ({ ...s, default: false }))]
                  : ARABIC_SUBTITLES
              }
              className="h-full w-full rounded-xl"
            />
            {/* Loader overlay — shown while we're waiting on the host
                for the title (no `tmdbId` yet) or while the resolver
                is in flight. The player below is the Mux fallback
                during this brief window. */}
            {!tmdbId && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
                <div className="pointer-events-none absolute -top-32 -right-32 size-72 rounded-full bg-brand/20 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-32 -left-32 size-72 rounded-full bg-fuchsia-500/15 blur-3xl" />
                <div className="relative flex flex-col items-center gap-4 text-center">
                  <div className="relative grid size-20 place-items-center rounded-3xl bg-gradient-to-br from-[#A855F7]/30 to-[#5B21B6]/30 ring-1 ring-white/10">
                    <Film className="size-9 animate-pulse text-brand" />
                  </div>
                  <div>
                    <p className="text-[14px] font-bold text-white">
                      بانتظار بيانات المضيف
                    </p>
                    <p className="mt-1 text-[12px] text-white/45">
                      يتم تنزيل جلسة المضيف لتزامن البث
                    </p>
                    <button
                      onClick={requestMedia}
                      className="pointer-events-auto mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/70 transition hover:border-brand/50 hover:text-white"
                    >
                      إعادة طلب البيانات
                    </button>
                  </div>
                </div>
              </div>
            )}
            {/* Sync overlay: shown only for non-host peers (skip the
                solo viewer — they ARE the host). */}
            {!canControlRoom && ready && (
              <div
                className="pointer-events-none absolute inset-0 grid place-items-center"
                aria-hidden
              >
                <div className="pointer-events-none rounded-full border border-brand/40 bg-black/55 px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-widest text-white/85 backdrop-blur">
                  {playing ? "▶ متزامن مع المضيف" : "❚❚ متزامن مع المضيف"}
                </div>
              </div>
            )}
          </div>

          {/* room info — all dynamic from TMDB */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/[0.07] bg-surface/70 px-4 py-3 backdrop-blur">
              <p className="text-[11px] text-white/40">المحتوى</p>
              <p className="mt-0.5 truncate text-[13.5px] font-semibold text-white">
                {movie.name}
                {movie.year ? ` (${movie.year})` : ""}
              </p>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-surface/70 px-4 py-3 backdrop-blur">
              <p className="text-[11px] text-white/40">التصنيفات</p>
              <p className="mt-0.5 truncate text-[13.5px] font-semibold text-white">
                {genres}
              </p>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-surface/70 px-4 py-3 backdrop-blur">
              <p className="text-[11px] text-white/40">المدة</p>
              <p className="mt-0.5 truncate text-[13.5px] font-semibold text-white">
                {formatRuntime(details?.runtime) || movie.runtime || "—"}
              </p>
            </div>
            {synopsis && (
              <div className="sm:col-span-3 rounded-2xl border border-white/[0.07] bg-surface/70 px-4 py-3 backdrop-blur">
                <p className="text-[11px] text-white/40">القصة</p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-white/80">{synopsis}</p>
              </div>
            )}
            <div className="sm:col-span-3 rounded-2xl border border-white/[0.07] bg-surface/70 px-4 py-3 backdrop-blur">
              <p className="text-[11px] text-white/40">الخصوصية</p>
              <p className="mt-0.5 text-[13.5px] font-semibold text-white">
                غرفة خاصة · بالدعوة · كود {code}
              </p>
            </div>
          </div>
        </div>

        {/* ---------- sidebar ---------- */}
        <aside className="order-2 flex h-[70vh] min-h-[520px] flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-surface/70 backdrop-blur-xl lg:order-1 lg:h-auto lg:sticky lg:top-24">
          <div className="flex shrink-0 gap-1 border-b border-white/[0.07] p-2">
            {[
              { k: "chat", t: "الدردشة", I: MessageSquare },
              { k: "members", t: `الأعضاء · ${memberCount}`, I: Users },
            ].map((x) => (
              <button
                key={x.k}
                onClick={() => setTab(x.k as "chat" | "members")}
                className={cn(
                  "relative flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold transition",
                  tab === x.k ? "text-white" : "text-white/45 hover:text-white/80",
                )}
              >
                {tab === x.k && (
                  <motion.span
                    layoutId="room-tab"
                    className="absolute inset-0 rounded-xl border border-brand/30 bg-brand/12"
                  />
                )}
                <x.I className="relative size-4" />
                <span className="relative">{x.t}</span>
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {tab === "chat" ? (
              <motion.div
                key="chat"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.25 }}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="thin-scrollbar flex-1 space-y-4 overflow-y-auto p-4">
                  {messages.length === 0 && (
                    <p className="grid place-items-center py-10 text-center text-[12.5px] text-white/40">
                      لا توجد رسائل بعد. كن أول من يبدأ المحادثة 👋
                    </p>
                  )}
                  {messages.map((m) => {
                    // System messages (host handover / role change) get
                    // a centred banner treatment instead of the
                    // avatar/bubble layout so they read as events, not
                    // chat.
                    const isSystem = m.memberId === "system";
                    if (isSystem) {
                      return (
                        <motion.div
                          key={m.id}
                          initial={{ opacity: 0, y: 8, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{ duration: 0.25 }}
                          className="my-1 flex justify-center"
                        >
                          <div className="flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/[0.08] px-3 py-1.5 text-[11.5px] font-semibold text-amber-100">
                            <Crown className="size-3" />
                            <span>{m.text}</span>
                          </div>
                        </motion.div>
                      );
                    }
                    return (
                      <motion.div
                        key={m.id}
                        initial={{ opacity: 0, y: 12, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ type: "spring", stiffness: 300, damping: 24 }}
                        className="flex gap-2.5"
                      >
                        <img
                          src={m.avatar}
                          alt=""
                          className="size-8 shrink-0 rounded-full object-cover ring-1 ring-white/15"
                        />
                        <div className="max-w-[78%]">
                          <div className="mb-1 flex items-center gap-1.5">
                            <span className="text-[11.5px] font-bold text-white/80">
                              {m.name}
                            </span>
                            {m.memberId === canonicalHostId && (
                              <span className="inline-flex items-center gap-0.5 rounded-md bg-gradient-to-l from-amber-400 to-amber-200 px-1.5 py-[1px] text-[9px] font-black text-black">
                                <Crown className="size-2.5" /> HOST
                              </span>
                            )}
                            <span className="text-[10px] text-white/30">
                              {formatTime(m.ts)}
                            </span>
                          </div>
                          <div className="rounded-2xl rounded-tr-sm border border-white/[0.07] bg-white/[0.05] px-3.5 py-2.5 text-[13px] leading-relaxed text-white/85">
                            {m.text}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                  <div ref={chatEnd} />
                </div>

                <div className="shrink-0 border-t border-white/[0.07] p-3">
                  <AnimatePresence>
                    {showEmoji && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        className="mb-2 flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-2"
                      >
                        {EMOJIS.map((e) => (
                          <button
                            key={e}
                            type="button"
                            onClick={() => setDraft((d) => d + e)}
                            className="grid size-8 place-items-center rounded-lg text-lg transition hover:scale-125 hover:bg-white/10"
                          >
                            {e}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      send();
                    }}
                    className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-1.5 transition focus-within:border-brand/50"
                  >
                    <button
                      type="button"
                      onClick={() => setShowEmoji((s) => !s)}
                      className="grid size-8 place-items-center rounded-full text-white/55 transition hover:text-brand"
                    >
                      <Smile className="size-[18px]" />
                    </button>
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="اكتب رسالة…"
                      className="min-w-0 flex-1 bg-transparent text-[13px] text-white placeholder:text-white/30 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#A855F7] to-[#6D28D9] text-white shadow-lg transition hover:scale-105"
                    >
                      <Send className="size-4" />
                    </button>
                  </form>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="members"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ duration: 0.25 }}
                className="thin-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
              >
                {members.length === 0 && (
                  <p className="grid place-items-center py-10 text-center text-[12.5px] text-white/40">
                    بانتظار انضمام أول عضو…
                  </p>
                )}
                {members.map((m) => {
                  // Solo viewer or elected host can moderate. Also
                  // never allow moderating the host themselves.
                  const canMod = canControlRoom && !m.isHost;
                  const menuOpen = modFor === m.id;
                  return (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="relative flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-2.5 transition hover:border-brand/30 hover:bg-brand/[0.06]"
                    >
                      <div className="relative">
                        <img
                          src={m.avatar}
                          alt={m.name}
                          className="size-10 rounded-full object-cover ring-2 ring-brand/35"
                        />
                        <span className="absolute -bottom-0.5 -left-0.5 size-3 rounded-full border-2 border-[#121118] bg-emerald-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-[13px] font-bold text-white">{m.name}</p>
                          {m.isHost && (
                            <span className="inline-flex items-center gap-0.5 rounded-md bg-gradient-to-l from-amber-400 to-amber-200 px-1.5 py-[1px] text-[9px] font-black text-black">
                              <Crown className="size-2.5" /> HOST
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-white/40">
                          {m.isHost ? "يستضيف الآن" : "يشاهد الآن"}
                        </p>
                      </div>
                      {canMod && (
                        <button
                          onClick={() => setModFor(menuOpen ? null : m.id)}
                          className="grid size-8 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition hover:border-brand/40 hover:text-white"
                          title="إجراءات المضيف"
                          aria-label="إجراءات المضيف"
                        >
                          <MoreVertical className="size-4" />
                        </button>
                      )}

                      {/* Moderation popover (host-only). */}
                      <AnimatePresence>
                        {menuOpen && canMod && (
                          <motion.div
                            initial={{ opacity: 0, y: -6, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -6, scale: 0.96 }}
                            transition={{ duration: 0.15 }}
                            className="absolute end-2 top-12 z-10 w-44 overflow-hidden rounded-2xl border border-white/10 bg-[#121118]/95 shadow-2xl backdrop-blur-xl"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => {
                                transferHost(m.id);
                                setModFor(null);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2.5 text-right text-[12.5px] text-white/85 transition hover:bg-amber-400/15 hover:text-white"
                            >
                              <Crown className="size-3.5 text-amber-300" />
                              نقل الملكية
                            </button>
                            <div className="h-px bg-white/[0.06]" />
                            <button
                              onClick={() => {
                                kick(m.id);
                                setModFor(null);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2.5 text-right text-[12.5px] text-white/85 transition hover:bg-orange-400/15 hover:text-white"
                            >
                              <ShieldOff className="size-3.5 text-orange-300" />
                              طرد من الغرفة
                            </button>
                            <div className="h-px bg-white/[0.06]" />
                            <button
                              onClick={() => {
                                ban(m.id);
                                setModFor(null);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2.5 text-right text-[12.5px] text-rose-200 transition hover:bg-rose-500/15 hover:text-rose-100"
                            >
                              <Ban className="size-3.5 text-rose-300" />
                              حظر من الغرفة
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}

                <div className="mt-3 rounded-2xl border border-dashed border-brand/30 p-4 text-center">
                  <p className="text-[12.5px] text-white/50">شارك الكود لدعوة أصدقائك</p>
                  <p className="my-2 font-display text-xl font-black tracking-[0.3em] text-white">
                    {code}
                  </p>
                  <Button size="sm" variant="glass" onClick={() => copy("link")}>
                    {copied === "link" ? <Check className="size-4" /> : <Copy className="size-4" />}
                    نسخ رابط الدعوة
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </aside>
      </div>

      {/* Episode / season picker — host-only. Non-host peers see a
          read-only chip and the drawer refuses to open for them. */}
      {mediaType === "tv" && tmdbId && (
        <EpisodePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          tmdbId={tmdbId}
          numberOfSeasons={
            details?.number_of_seasons ?? movie.seasons ?? 1
          }
          season={season}
          episode={episode}
          disabled={!canControlRoom}
          onPick={(s, e) => {
            setSeason(s);
            setEpisode(e);
            if (canControlRoom) broadcastEpisode(s, e);
          }}
        />
      )}
    </motion.div>
  );
}
