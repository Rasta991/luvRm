import Hls from "hls.js";
import {
  AlertTriangle,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /** HLS manifest URL. Must end in `.m3u8`. */
  streamUrl?: string;
  /** Poster image shown before the first frame. */
  poster?: string;
  /** Display title (used for aria). */
  title?: string;
  /** External subtitle tracks to expose to the native <track> UI. */
  subtitles?: SubtitleTrack[];
  /** Autoplay when ready. Browsers may block this without a user gesture. */
  autoPlay?: boolean;
  /** Show the in-player quality selector. Defaults to true when levels > 1. */
  showQualityMenu?: boolean;
  /** Show the in-player subtitle menu. Defaults to true when tracks > 0. */
  showSubtitleMenu?: boolean;
  /** Force a fresh remount when this changes (e.g. when navigating episodes). */
  reloadKey?: string;
  className?: string;
}

interface QualityLevel {
  /** hls.js level index, or -1 for auto. */
  index: number;
  width: number;
  height: number;
  bitrate: number;
  label: string;
}

/** Public Mux test stream — multi-bitrate HLS, safe for development. */
const DEFAULT_STREAM =
  "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

/** Format a bitrate (bits/s) as Mbps / kbps for the picker. */
function formatBitrate(bitrate: number): string {
  if (!isFinite(bitrate) || bitrate <= 0) return "";
  if (bitrate >= 1_000_000) return `${(bitrate / 1_000_000).toFixed(2)} Mbps`;
  return `${Math.round(bitrate / 1_000)} kbps`;
}

/** Human-readable time string (mm:ss / h:mm:ss). */
function fmt(t: number): string {
  if (!isFinite(t) || t < 0) return "00:00";
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  const m = Math.floor((t / 60) % 60).toString().padStart(2, "0");
  const h = Math.floor(t / 3600);
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

/** Build a display label for an hls.js level, e.g. "1080p · 5.20 Mbps". */
function levelLabel(level: { width: number; height: number; bitrate: number }): string {
  const res = level.height ? `${level.height}p` : level.width ? `${level.width}w` : "";
  const br = formatBitrate(level.bitrate);
  return [res, br].filter(Boolean).join(" · ") || "Track";
}

/**
 * Production HLS player built on `hls.js`.
 *
 * - Native HLS (Safari/iOS) when available; MSE fallback everywhere else.
 * - External WebVTT/SubRip subtitle tracks via <track>.
 * - In-player quality picker driven by hls.js levels.
 * - Cleans up the Hls instance and all event listeners on unmount / reload.
 */
export function VideoPlayer({
  streamUrl = DEFAULT_STREAM,
  poster,
  title,
  subtitles = [],
  autoPlay = false,
  showQualityMenu,
  showSubtitleMenu,
  reloadKey,
  className,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1); // -1 = auto
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"quality" | "subtitles">("quality");
  const [activeSubtitleLang, setActiveSubtitleLang] = useState<string | null>(() => {
    const def = subtitles.find((s) => s.default);
    return def?.lang ?? null;
  });

  // -------- attach hls.js / native src -----------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setIsLoading(true);
    setError(null);
    setLevels([]);
    setCurrentLevel(-1);

    // Clean up any previous instance.
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const canNative = video.canPlayType("application/vnd.apple.mpegurl") !== "";

    if (canNative || !Hls.isSupported()) {
      // Safari / iOS: hand the manifest directly to the <video>.
      video.src = streamUrl;
    } else {
      const hls = new Hls({
        // Reasonable defaults for VOD; tweak as your CDN needs.
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

      hls.loadSource(streamUrl);
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
  }, [streamUrl, reloadKey]);

  // -------- surface hls.js levels to React -------------------------------
  useEffect(() => {
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
        // Avoid setState if nothing meaningfully changed.
        if (
          prev.length === mapped.length &&
          prev.every((p, i) => p.height === mapped[i].height && p.bitrate === mapped[i].bitrate)
        ) {
          return prev;
        }
        return mapped;
      });
      window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [streamUrl, reloadKey]);

  // -------- video element events -----------------------------------------
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
  }, []);

  // -------- controls ------------------------------------------------------
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
    hls.currentLevel = index; // -1 = auto
    setCurrentLevel(index);
  }, []);

  const setSubtitle = useCallback((lang: string | null) => {
    const video = videoRef.current;
    if (!video) return;
    const tracks = Array.from(video.textTracks);
    for (const track of tracks) {
      // mode === 'showing' is the standard for "active subtitle track".
      track.mode = lang !== null && track.language === lang ? "showing" : "disabled";
    }
    setActiveSubtitleLang(lang);
  }, []);

  const fullscreen = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void video.requestFullscreen?.();
    }
  }, []);

  const reload = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    void video.load();
    void video.play();
  }, []);

  const qualityMenuOpen = showQualityMenu ?? levels.length > 1;
  const subtitleMenuOpen = showSubtitleMenu ?? subtitles.length > 0;

  const progress = useMemo(() => {
    if (!duration || !isFinite(duration)) return 0;
    return Math.min(100, (currentTime / duration) * 100);
  }, [currentTime, duration]);

  return (
    <div
      className={cn(
        "group relative w-full overflow-hidden rounded-xl bg-black",
        className,
      )}
      dir="ltr"
      data-title={title}
    >
      <video
        ref={videoRef}
        poster={poster}
        controls={false}
        playsInline
        autoPlay={autoPlay}
        muted={isMuted}
        crossOrigin="anonymous"
        className="block aspect-video w-full bg-black"
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

      {/* Loading + error overlay */}
      {isLoading && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
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

      {/* Controls — visible on hover for desktop, always visible while paused on mobile */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 opacity-100 transition-opacity group-hover:opacity-100" dir="ltr">
        <div className="pointer-events-auto flex items-center gap-3 text-white">
          <button
            type="button"
            onClick={togglePlay}
            className="rounded-full p-2 hover:bg-white/10"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
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

          {(qualityMenuOpen || subtitleMenuOpen) && (
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
                <div className="absolute bottom-14 right-0 w-56 max-w-[calc(100%-1rem)] overflow-hidden rounded-lg bg-black/95 text-sm text-white shadow-xl ring-1 ring-white/10">
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
                              {currentLevel === lvl.index && <span className="text-xs">●</span>}
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
                            {activeSubtitleLang === null && <span className="text-xs">●</span>}
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
            aria-label="Fullscreen"
          >
            <ChevronDown className="h-5 w-5 -rotate-45" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default VideoPlayer;
