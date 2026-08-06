import Hls from "hls.js";
import {
  AlertTriangle,
  Captions,
  ChevronDown,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Settings as SettingsIcon,
  Subtitles,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EmbedServer } from "../lib/stream";
import { cn } from "../utils/cn";

export interface SubtitleTrack {
  /** BCP-47 language tag, e.g. "ar", "en", "fr". */
  lang: string;
  /** Display label shown in the picker, e.g. "العربية". */
  label: string;
  /** Absolute URL to a WebVTT (.vtt) or SubRip (.srt) file. */
  file: string;
  /** If true, this track starts enabled. Only one track should set this. */
  default?: boolean;
}

export interface VideoPlayerProps {
  /**
   * The embed server currently in use. Pass `null` to render the
   * "no playable stream" placeholder.
   *
   * `kind: "hls"` → uses hls.js / native HLS for the manifest URL.
   * `kind: "iframe"` → renders an iframe whose `src` is the embed URL.
   */
  server: EmbedServer | null;
  /** Poster image shown before the first frame (HLS only). */
  poster?: string;
  /** Display title (used for aria). */
  title?: string;
  /** External subtitle tracks. Only effective for `kind: "hls"`. */
  subtitles?: SubtitleTrack[];
  /** Autoplay when ready. Browsers may block this without a user gesture. */
  autoPlay?: boolean;
  /** Force a fresh remount when this changes (e.g. when navigating episodes). */
  reloadKey?: string;
  /**
   * Reports iframe load events back to the parent so the server
   * switcher can update its status dots. Only used for iframe servers.
   */
  onServerStatus?: (status: "loading" | "ok" | "failed") => void;
  className?: string;
}

interface QualityLevel {
  index: number;
  width: number;
  height: number;
  bitrate: number;
  label: string;
}

function formatBitrate(bitrate: number): string {
  if (!isFinite(bitrate) || bitrate <= 0) return "";
  if (bitrate >= 1_000_000) return `${(bitrate / 1_000_000).toFixed(2)} Mbps`;
  return `${Math.round(bitrate / 1_000)} kbps`;
}

function fmt(t: number): string {
  if (!isFinite(t) || t < 0) return "00:00";
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  const m = Math.floor((t / 60) % 60).toString().padStart(2, "0");
  const h = Math.floor(t / 3600);
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function levelLabel(level: { width: number; height: number; bitrate: number }): string {
  const res = level.height ? `${level.height}p` : level.width ? `${level.width}w` : "";
  const br = formatBitrate(level.bitrate);
  return [res, br].filter(Boolean).join(" · ") || "Track";
}

const IFRAME_LOAD_TIMEOUT_MS = 8000;

/**
 * Production embed-aware player.
 *
 * Renders one of two surfaces based on `server.kind`:
 *
 *   - `hls`    → hls.js for browsers that need it, native HLS for
 *                Safari. Quality picked from real hls.js levels.
 *   - `iframe` → just an iframe with the embed URL. We can't drive
 *                the embed's internal quality from the outside, so
 *                the quality menu is hidden for iframe servers.
 *
 * Fullscreen works for both surfaces: the wrapper is the fullscreen
 * element, the iframe inside fills the wrapper, and the HLS video
 * uses its native requestFullscreen API paired with the wrapper.
 */
export function VideoPlayer({
  server,
  poster,
  title,
  subtitles = [],
  autoPlay = false,
  reloadKey,
  onServerStatus,
  className,
}: VideoPlayerProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const loadTimerRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"quality" | "subtitles">("quality");
  const [activeSubtitleLang, setActiveSubtitleLang] = useState<string | null>(() => {
    const def = subtitles.find((s) => s.default);
    return def?.lang ?? null;
  });
  const [isFullscreen, setIsFullscreen] = useState(false);

  const isIframe = server?.kind === "iframe";
  const isHls = server?.kind === "hls";

  // ───────── fullscreen wiring ──────────────────────────────────────────
  useEffect(() => {
    const onFs = () => {
      const fs =
        document.fullscreenElement ||
        (document as Document & { webkitFullscreenElement?: Element })
          .webkitFullscreenElement;
      setIsFullscreen(!!fs);
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

  // ───────── HLS attach ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isHls || !server) return;
    const video = videoRef.current;
    if (!video) return;

    setIsLoading(true);
    setError(null);
    setLevels([]);
    setCurrentLevel(-1);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const canNative = video.canPlayType("application/vnd.apple.mpegurl") !== "";

    if (canNative || !Hls.isSupported()) {
      video.src = server.url;
    } else {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 60,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return;
        setError(`Playback error: ${data.type} / ${data.details}`);
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default:
            hls.destroy();
            break;
        }
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => {
        setCurrentLevel(data.level);
      });

      hls.loadSource(server.url);
      hls.attachMedia(video);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeAttribute("src");
      video.load();
    };
  }, [server?.url, isHls, reloadKey]);

  // ───────── iframe load + timeout ──────────────────────────────────────
  useEffect(() => {
    if (!isIframe || !server) return;
    if (loadTimerRef.current) {
      window.clearTimeout(loadTimerRef.current);
      loadTimerRef.current = null;
    }
    onServerStatus?.("loading");
    setIsLoading(true);
    setError(null);
    loadTimerRef.current = window.setTimeout(() => {
      // Eight seconds is the generous upper bound for embed pages to
      // fire load. Most fast servers (Vidsrc, MultiEmbed) load in
      // under 2s; we wait 8s so a slow connection doesn't trip the
      // "failed" status unnecessarily.
      onServerStatus?.("failed");
      setError("Embed took too long to load.");
    }, IFRAME_LOAD_TIMEOUT_MS);
    return () => {
      if (loadTimerRef.current) {
        window.clearTimeout(loadTimerRef.current);
        loadTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.url, isIframe, reloadKey]);

  // ───────── surface hls.js levels ──────────────────────────────────────
  useEffect(() => {
    if (!isHls) return;
    const id = window.setInterval(() => {
      const hls = hlsRef.current;
      if (!hls) return;
      const lvls = hls.levels;
      if (lvls.length === 0) return;
      const mapped: QualityLevel[] = lvls.map((lvl, i) => ({
        index: i,
        width: lvl.width ?? 0,
        height: lvl.height ?? 0,
        bitrate: lvl.bitrate ?? 0,
        label: levelLabel(lvl),
      }));
      setLevels((prev) => {
        if (
          prev.length === mapped.length &&
          prev.every(
            (p, i) => p.height === mapped[i].height && p.bitrate === mapped[i].bitrate,
          )
        ) {
          return prev;
        }
        return mapped;
      });
      window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [isHls, server?.url, reloadKey]);

  // ───────── <video> events ─────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => setCurrentTime(video.currentTime);
    const onDur = () => setDuration(video.duration);
    const onWaiting = () => setIsLoading(true);
    const onPlaying = () => setIsLoading(false);
    const onCanPlay = () => setIsLoading(false);
    const onVol = () => {
      setVolume(video.volume);
      setIsMuted(video.muted);
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onDur);
    video.addEventListener("durationchange", onDur);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("volumechange", onVol);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onDur);
      video.removeEventListener("durationchange", onDur);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("volumechange", onVol);
    };
  }, [isHls]);

  // ───────── controls ───────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }, []);

  const handleSeek = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = value;
    setCurrentTime(value);
  }, []);

  const handleSeekInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleSeek(Number(e.target.value));
    },
    [handleSeek],
  );

  const handleVolumeInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const v = Number(e.target.value);
    video.volume = v;
    video.muted = v === 0;
  }, []);

  const selectLevel = useCallback((index: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = index;
    setCurrentLevel(index);
  }, []);

  const setSubtitle = useCallback((lang: string | null) => {
    const video = videoRef.current;
    if (!video) return;
    const tracks = Array.from(video.textTracks);
    for (const track of tracks) {
      track.mode = lang !== null && track.language === lang ? "showing" : "disabled";
    }
    setActiveSubtitleLang(lang);
  }, []);

  const fullscreen = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      // The wrapper is the fullscreen element. Works for both HLS
      // (the <video> inside fills the wrapper) and iframe (the
      // iframe inside fills the wrapper). Stable layout in both
      // modes.
      const req =
        wrap.requestFullscreen?.bind(wrap) ||
        (wrap as HTMLDivElement & {
          webkitRequestFullscreen?: () => Promise<void>;
        }).webkitRequestFullscreen?.bind(wrap);
      void req?.();
    }
  }, []);

  const reload = useCallback(() => {
    setError(null);
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      void video.load();
      void video.play();
    }
  }, []);

  // ───────── derived UI state ───────────────────────────────────────────
  const qualityMenuOpen = isHls && (server?.hasQuality ?? true) && levels.length > 1;
  const subtitleMenuOpen = isHls && subtitles.length > 0;
  const showSettingsUI = qualityMenuOpen || subtitleMenuOpen;

  const progress = useMemo(() => {
    if (!duration || !isFinite(duration)) return 0;
    return Math.min(100, (currentTime / duration) * 100);
  }, [currentTime, duration]);

  // ───────── render ─────────────────────────────────────────────────────
  return (
    <div
      ref={wrapRef}
      className={cn(
        "video-player-wrap group relative h-full w-full overflow-hidden rounded-xl bg-black",
        className,
      )}
      data-fs={isFullscreen ? "true" : "false"}
      dir="ltr"
      data-title={title}
      data-server-key={server?.key ?? "none"}
      data-server-kind={server?.kind ?? "none"}
    >
      {server ? (
        isHls ? (
          <video
            ref={videoRef}
            poster={poster}
            controls={false}
            playsInline
            autoPlay={autoPlay}
            muted={isMuted}
            crossOrigin="anonymous"
            className="block aspect-video h-full w-full bg-black object-contain"
            aria-label={title ?? "Video player"}
          >
            {subtitles.map((s) => (
              <track
                key={`${s.lang}-${s.file}`}
                kind="subtitles"
                src={s.file}
                srcLang={s.lang}
                label={s.label}
                default={s.default}
              />
            ))}
          </video>
        ) : (
          <iframe
            key={server.url}
            src={server.url}
            title={title ?? server.label}
            className="block aspect-video h-full w-full border-0 bg-black"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
            allowFullScreen
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-forms"
            loading="eager"
            onLoad={() => {
              if (loadTimerRef.current) {
                window.clearTimeout(loadTimerRef.current);
                loadTimerRef.current = null;
              }
              onServerStatus?.("ok");
              setIsLoading(false);
            }}
            onError={() => {
              if (loadTimerRef.current) {
                window.clearTimeout(loadTimerRef.current);
                loadTimerRef.current = null;
              }
              onServerStatus?.("failed");
              setError("Embed failed to load.");
            }}
          />
        )
      ) : (
        <div className="grid aspect-video h-full w-full place-items-center text-center text-white/55">
          <div>
            <AlertTriangle className="mx-auto size-10 text-amber-400" />
            <p className="mt-2 text-sm">No playable stream yet.</p>
          </div>
        </div>
      )}

      {/* Loading + error overlay */}
      {isLoading && !error && server && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
          <Loader2 className="h-10 w-10 animate-spin text-white/80" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-center text-white">
          <AlertTriangle className="h-10 w-10 text-amber-400" />
          <p className="max-w-md px-4 text-sm">{error}</p>
          <button
            type="button"
            onClick={reload}
            className="inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
          >
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </div>
      )}

      {/* Controls — only when we have a server */}
      {server && (
        <div
          className="video-controls pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3"
          dir="ltr"
        >
          <div className="pointer-events-auto flex items-center gap-3 text-white">
            {isHls && (
              <>
                <button
                  type="button"
                  onClick={togglePlay}
                  className="rounded-full p-2 hover:bg-white/10"
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? (
                    <Pause className="h-5 w-5" />
                  ) : (
                    <Play className="h-5 w-5" />
                  )}
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleMute}
                    className="rounded-full p-2 hover:bg-white/10"
                    aria-label={isMuted ? "Unmute" : "Mute"}
                  >
                    {isMuted || volume === 0 ? (
                      <VolumeX className="h-5 w-5" />
                    ) : (
                      <Volume2 className="h-5 w-5" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={volume}
                    onChange={handleVolumeInput}
                    className="h-1 w-20 cursor-pointer accent-white"
                    aria-label="Volume"
                  />
                </div>

                <div className="flex flex-1 items-center gap-2">
                  <span className="text-xs tabular-nums">{fmt(currentTime)}</span>
                  <input
                    type="range"
                    min={0}
                    max={isFinite(duration) && duration > 0 ? duration : 0}
                    step={0.1}
                    value={currentTime}
                    onChange={handleSeekInput}
                    className="h-1 flex-1 cursor-pointer accent-white"
                    aria-label="Seek"
                    style={{ ["--p" as string]: `${progress}%` }}
                  />
                  <span className="text-xs tabular-nums">{fmt(duration)}</span>
                </div>
              </>
            )}

            {/* Iframe server — show a compact status pill where the
                play/pause controls would be, since we can't drive the
                embed's own UI. */}
            {isIframe && (
              <div className="flex flex-1 items-center gap-2 text-[11px] text-white/70">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-2 py-1">
                  <Captions className="size-3.5" />
                  {server.label.split(" — ")[1] ?? server.label}
                </span>
              </div>
            )}

            {showSettingsUI && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowSettings((s) => !s)}
                  className="rounded-full p-2 hover:bg-white/10"
                  aria-label="Settings"
                  aria-expanded={showSettings}
                >
                  <SettingsIcon className="h-5 w-5" />
                </button>
                {showSettings && (
                  <div className="absolute bottom-14 right-0 w-64 max-w-[calc(100%-1rem)] overflow-hidden rounded-lg bg-black/95 text-sm text-white shadow-xl ring-1 ring-white/10">
                    <div className="flex border-b border-white/10">
                      {qualityMenuOpen && (
                        <button
                          type="button"
                          onClick={() => setSettingsTab("quality")}
                          className={cn(
                            "flex-1 px-3 py-2",
                            settingsTab === "quality" && "bg-white/10",
                          )}
                        >
                          Quality
                        </button>
                      )}
                      {subtitleMenuOpen && (
                        <button
                          type="button"
                          onClick={() => setSettingsTab("subtitles")}
                          className={cn(
                            "flex-1 px-3 py-2",
                            settingsTab === "subtitles" && "bg-white/10",
                          )}
                        >
                          Subtitles
                        </button>
                      )}
                    </div>
                    <ul className="max-h-72 overflow-y-auto">
                      {settingsTab === "quality" && (
                        <>
                          <li>
                            <button
                              type="button"
                              onClick={() => selectLevel(-1)}
                              className={cn(
                                "flex w-full items-center justify-between px-3 py-2 hover:bg-white/10",
                                currentLevel === -1 && "bg-white/10",
                              )}
                            >
                              <span>Auto</span>
                              {currentLevel === -1 && <span className="text-xs">●</span>}
                            </button>
                          </li>
                          {levels.map((lvl) => (
                            <li key={lvl.index}>
                              <button
                                type="button"
                                onClick={() => selectLevel(lvl.index)}
                                className={cn(
                                  "flex w-full items-center justify-between px-3 py-2 hover:bg-white/10",
                                  currentLevel === lvl.index && "bg-white/10",
                                )}
                              >
                                <span>{lvl.label}</span>
                                {currentLevel === lvl.index && (
                                  <span className="text-xs">●</span>
                                )}
                              </button>
                            </li>
                          ))}
                        </>
                      )}
                      {settingsTab === "subtitles" && (
                        <>
                          <li>
                            <button
                              type="button"
                              onClick={() => setSubtitle(null)}
                              className={cn(
                                "flex w-full items-center justify-between px-3 py-2 hover:bg-white/10",
                                activeSubtitleLang === null && "bg-white/10",
                              )}
                            >
                              <span className="inline-flex items-center gap-2">
                                <Subtitles className="h-4 w-4" /> Off
                              </span>
                              {activeSubtitleLang === null && (
                                <span className="text-xs">●</span>
                              )}
                            </button>
                          </li>
                          {subtitles.map((s) => (
                            <li key={`${s.lang}-${s.file}`}>
                              <button
                                type="button"
                                onClick={() => setSubtitle(s.lang)}
                                className={cn(
                                  "flex w-full items-center justify-between px-3 py-2 hover:bg-white/10",
                                  activeSubtitleLang === s.lang && "bg-white/10",
                                )}
                              >
                                <span>{s.label}</span>
                                {activeSubtitleLang === s.lang && (
                                  <span className="text-xs">●</span>
                                )}
                              </button>
                            </li>
                          ))}
                        </>
                      )}
                    </ul>
                    <button
                      type="button"
                      onClick={() => setShowSettings(false)}
                      className="block w-full border-t border-white/10 px-3 py-2 text-left hover:bg-white/10"
                    >
                      Close
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={fullscreen}
              className="rounded-full p-2 hover:bg-white/10"
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              <ChevronDown className="h-5 w-5 -rotate-45" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default VideoPlayer;
