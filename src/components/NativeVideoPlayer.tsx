import {
  Maximize2,
  Pause,
  Play,
  Subtitles,
  Volume2,
  VolumeX,
  Settings as SettingsIcon,
  ChevronDown,
  Loader2,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../utils/cn";
import type { StreamSource, SubtitleTrack } from "../lib/streams";
import { loadHls, supportsNativeHls } from "../lib/hlsLoader";

interface NativeVideoPlayerProps {
  source: StreamSource | null;
  /** Poster image shown before the first frame. */
  poster?: string;
  /** Display title (used for aria + document.title). */
  title?: string;
  /** Force a fresh remount when this changes. */
  reloadKey: string;
}

/** Human-readable time string (mm:ss / h:mm:ss). */
function fmt(t: number): string {
  if (!isFinite(t) || t < 0) return "00:00";
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  const m = Math.floor((t / 60) % 60).toString().padStart(2, "0");
  const h = Math.floor(t / 3600);
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

/**
 * Native, ad-free HLS player. Renders a styled HTML5 <video> with custom
 * controls. No sandbox, no iframes, no third-party UI.
 */
export function NativeVideoPlayer({
  source,
  poster,
  title,
  reloadKey,
}: NativeVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);

  // hls.js instance is kept in a ref so we can call destroy() on cleanup.
  const hlsRef = useRef<{ destroy: () => void } | null>(null);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<{ index: number; height?: number; bitrate?: number }[]>([]);
  const [levelIdx, setLevelIdx] = useState<number>(-1);
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [uiVisible, setUiVisible] = useState(true);
  const [hovering, setHovering] = useState(false);

  /* ----------  Sync prop changes to the video element  ---------- */
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !source) return;
    setError(null);
    setLoading(true);
    setLevels([]);
    setLevelIdx(-1);

    // Tidy up any previous Hls instance.
    hlsRef.current?.destroy();
    hlsRef.current = null;

    const isHls = /\.m3u8(\?|$)/i.test(source.url) || source.mime === "application/vnd.apple.mpegurl";

    if (isHls && !supportsNativeHls()) {
      // Chrome / Firefox / Edge — load hls.js from CDN and attach.
      let cancelled = false;
      loadHls().then((Hls) => {
        if (cancelled || !v || !Hls) {
          if (!Hls) setError("تعذّر تحميل مشغّل HLS");
          return;
        }
        const inst = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 30,
        });
        inst.loadSource(source.url);
        inst.attachMedia(v);
        hlsRef.current = inst;
        inst.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
          const ls = (data.levels ?? []).map((l, i) => ({
            index: i,
            height: l.height,
            bitrate: l.bitrate,
          }));
          setLevels(ls);
        });
        inst.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) setError(`خطأ في البث: ${data.details ?? data.type}`);
        });
      });
      return () => {
        cancelled = true;
        hlsRef.current?.destroy();
        hlsRef.current = null;
      };
    }

    // Native path — Safari, iOS, or non-HLS source.
    v.src = source.url;
    return () => {
      v.removeAttribute("src");
      v.load();
    };
  }, [source, reloadKey]);

  /* ----------  Wire up subtitles  ---------- */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // Clear any tracks the browser already has. Track elements are
    // children of the <video>; we collect them first so we don't mutate
    // the live HTMLCollection while iterating.
    const existing = Array.from(v.querySelectorAll<HTMLTrackElement>("track"));
    for (const el of existing) v.removeChild(el);
    v.textTracks; // touch the TextTrackList to ensure the browser parses our new tracks
    if (!source?.subs) return;
    for (const s of source.subs) {
      if (!s.src) continue;
      const t = document.createElement("track");
      t.kind = "subtitles";
      t.label = s.label;
      t.srclang = s.lang;
      t.src = s.src;
      if (s.default) t.default = true;
      v.appendChild(t);
    }
    const defaultLang = source.subs.find((s) => s.default)?.lang ?? source.subs[0]?.lang ?? null;
    setActiveSub(defaultLang);
  }, [source, reloadKey]);

  /* ----------  DOM event listeners  ---------- */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setTime(v.currentTime);
    const onDur = () => setDuration(v.duration || 0);
    const onProg = () => {
      if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
    };
    const onWait = () => setLoading(true);
    const onPlay = () => {
      setPlaying(true);
      setLoading(false);
    };
    const onPause = () => setPlaying(false);
    const onCanPlay = () => setLoading(false);
    const onVol = () => {
      setVolume(v.volume);
      setMuted(v.muted);
    };
    const onErr = () => setError("تعذّر تشغيل المصدر. جرّب سيرفرًا آخر.");
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("durationchange", onDur);
    v.addEventListener("loadedmetadata", onDur);
    v.addEventListener("progress", onProg);
    v.addEventListener("waiting", onWait);
    v.addEventListener("playing", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("volumechange", onVol);
    v.addEventListener("error", onErr);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("loadedmetadata", onDur);
      v.removeEventListener("progress", onProg);
      v.removeEventListener("waiting", onWait);
      v.removeEventListener("playing", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("volumechange", onVol);
      v.removeEventListener("error", onErr);
    };
  }, []);

  /* ----------  UI helpers  ---------- */
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => setError("النقر مطلوب لبدء التشغيل"));
    else v.pause();
  }, []);

  const seek = (ratio: number) => {
    const v = videoRef.current;
    if (!v || !isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.duration * ratio));
  };

  const setVol = (val: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = Math.max(0, Math.min(1, val));
    if (v.volume === 0) v.muted = true;
    else v.muted = false;
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
  };

  const goFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.().catch(() => {});
  };

  const pickLevel = (idx: number) => {
    setLevelIdx(idx);
    if (hlsRef.current && "currentLevel" in hlsRef.current) {
      (hlsRef.current as unknown as { currentLevel: number }).currentLevel = idx;
    }
  };

  const pickSub = (lang: string | null) => {
    const v = videoRef.current;
    if (!v) return;
    setActiveSub(lang);
    for (let i = 0; i < v.textTracks.length; i++) {
      const t = v.textTracks[i];
      t.mode = lang && t.language === lang ? "showing" : "hidden";
    }
  };

  /* ----------  Auto-hide controls  ---------- */
  const bumpUi = useCallback(() => {
    setUiVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!hovering) setUiVisible(false);
    }, 2600);
  }, [hovering]);

  useEffect(() => {
    bumpUi();
    const onMove = () => bumpUi();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("keydown", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("keydown", onMove);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [bumpUi]);

  /* ----------  Keyboard shortcuts  ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "f") {
        e.preventDefault();
        goFullscreen();
      } else if (e.key === "m") {
        e.preventDefault();
        toggleMute();
      } else if (e.key === "ArrowRight") {
        const v = videoRef.current;
        if (v) v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
      } else if (e.key === "ArrowLeft") {
        const v = videoRef.current;
        if (v) v.currentTime = Math.max(0, v.currentTime - 10);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  const progressPct = duration > 0 ? (time / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  const sortedLevels = useMemo(
    () => [...levels].sort((a, b) => (b.height ?? 0) - (a.height ?? 0)),
    [levels],
  );

  const noSource = !source;

  return (
    <div
      ref={wrapRef}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={cn(
        "group/player relative aspect-video w-full overflow-hidden rounded-3xl border border-white/[0.08] bg-black",
        "shadow-[0_30px_90px_-40px_rgba(168,85,247,0.7)]",
      )}
    >
      {/* The actual <video> element. No sandbox, no iframe. */}
      <video
        ref={videoRef}
        className="size-full bg-black object-contain"
        poster={poster}
        playsInline
        crossOrigin="anonymous"
        title={title}
      />

      {/* Click-to-toggle overlay. Sits over the video, under the controls. */}
      <button
        onClick={togglePlay}
        aria-label={playing ? "إيقاف مؤقت" : "تشغيل"}
        className="absolute inset-0 grid place-items-center"
      >
        {!playing && !loading && (
          <span className="grid size-20 place-items-center rounded-full bg-white/95 text-black shadow-2xl transition group-hover/player:scale-105">
            <Play className="size-8 fill-current" />
          </span>
        )}
      </button>

      {/* Top-centered loading indicator. */}
      {loading && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="grid size-16 place-items-center rounded-full bg-black/60 backdrop-blur">
            <Loader2 className="size-7 animate-spin text-[#A855F7]" />
          </span>
        </div>
      )}

      {/* Error overlay with retry. */}
      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black/60 backdrop-blur-sm">
          <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-red-500/30 bg-black/70 p-5 text-center">
            <AlertTriangle className="size-7 text-red-300" />
            <p className="text-[13.5px] font-semibold text-white">{error}</p>
            <p className="text-[11.5px] text-white/55">
              جرّب سيرفرًا آخر من الشريط أسفل المشغّل.
            </p>
            <button
              onClick={() => {
                setError(null);
                videoRef.current?.load();
              }}
              className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-l from-[#7C3AED] to-[#A855F7] px-4 py-1.5 text-[12px] font-bold text-white"
            >
              <RefreshCw className="size-3.5" />
              إعادة المحاولة
            </button>
          </div>
        </div>
      )}

      {/* Top-left server tag. */}
      {source && (
        <div className="pointer-events-none absolute left-3 top-3 z-10">
          <span className="rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white/85 backdrop-blur">
            {labelForOrigin(source.origin)}
          </span>
        </div>
      )}

      {/* Bottom controls. Auto-hide when the mouse is idle. */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-20 transition-opacity duration-300",
          uiVisible || !playing ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div className="bg-gradient-to-t from-black/85 via-black/40 to-transparent px-4 pb-3 pt-10">
          {/* Seekbar */}
          <div
            className="group/bar relative h-1.5 cursor-pointer rounded-full bg-white/15"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const x = (e.clientX - r.left) / r.width;
              seek(x);
            }}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-white/25"
              style={{ width: `${bufferedPct}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#A855F7] to-[#E879F9]"
              style={{ width: `${progressPct}%` }}
            />
            <div
              className="absolute top-1/2 size-3.5 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white opacity-0 shadow-lg transition group-hover/bar:opacity-100"
              style={{ left: `${progressPct}%` }}
            />
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            {/* Play / Pause */}
            <button
              onClick={togglePlay}
              className="grid size-10 place-items-center rounded-full bg-white text-black shadow-lg transition hover:scale-105"
              title={playing ? "إيقاف" : "تشغيل"}
            >
              {playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 fill-current" />}
            </button>

            {/* Volume */}
            <div className="group/vol ml-1 flex items-center gap-2">
              <button
                onClick={toggleMute}
                className="grid size-9 place-items-center rounded-full text-white/85 hover:bg-white/10 hover:text-white"
                title={muted ? "إلغاء الكتم" : "كتم"}
              >
                {muted || volume === 0 ? <VolumeX className="size-[18px]" /> : <Volume2 className="size-[18px]" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => setVol(Number(e.target.value))}
                className="h-1 w-0 origin-left scale-x-0 cursor-pointer rounded-full bg-white/20 transition-all duration-200 group-hover/vol:w-24 group-hover/vol:scale-x-100"
                style={{ appearance: "none" as const }}
                title="مستوى الصوت"
              />
            </div>

            {/* Time */}
            <div className="ml-1 font-mono text-[12px] tabular-nums text-white/80">
              {fmt(time)} <span className="text-white/40">/ {fmt(duration)}</span>
            </div>

            <div className="flex-1" />

            {/* Subtitles */}
            {source?.subs && source.subs.length > 0 && (
              <SubtitleMenu subs={source.subs} active={activeSub} onPick={pickSub} />
            )}

            {/* Quality / Settings */}
            <SettingsMenu
              levels={sortedLevels}
              levelIdx={levelIdx}
              onLevel={pickLevel}
              open={showSettings}
              setOpen={setShowSettings}
            />

            {/* Fullscreen */}
            <button
              onClick={goFullscreen}
              className="grid size-9 place-items-center rounded-full text-white/85 hover:bg-white/10 hover:text-white"
              title="ملء الشاشة"
            >
              <Maximize2 className="size-[18px]" />
            </button>
          </div>
        </div>
      </div>

      {/* Empty / loading state. */}
      {noSource && (
        <div className="absolute inset-0 grid place-items-center">
          <p className="text-[13px] text-white/45">جاري تجهيز البث…</p>
        </div>
      )}
    </div>
  );
}

function labelForOrigin(o: StreamSource["origin"]): string {
  switch (o) {
    case "vidlink-stream":
      return "VidLink · HLS مباشر";
    case "vidlink-embed":
      return "VidLink";
    case "autoembed-stream":
      return "AutoEmbed · HLS مباشر";
    case "autoembed-embed":
      return "AutoEmbed";
  }
}

/* ───────────────  Sub-menu components  ─────────────── */

function MenuShell({
  open,
  button,
  children,
}: {
  open: boolean;
  button: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      {button}
      {open && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 min-w-[160px] rounded-xl border border-white/10 bg-black/85 p-1.5 text-[12.5px] shadow-2xl backdrop-blur-xl">
          {children}
        </div>
      )}
    </div>
  );
}

function SubtitleMenu({
  subs,
  active,
  onPick,
}: {
  subs: SubtitleTrack[];
  active: string | null;
  onPick: (lang: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <MenuShell
      open={open}
      button={
        <button
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "grid size-9 place-items-center rounded-full text-white/85 hover:bg-white/10 hover:text-white",
            active ? "text-[#A855F7]" : "",
          )}
          title="الترجمات"
        >
          <Subtitles className="size-[18px]" />
        </button>
      }
    >
      <p className="px-2 py-1 text-[10.5px] font-bold uppercase tracking-widest text-white/40">
        الترجمة
      </p>
      <button
        onClick={() => {
          onPick(null);
          setOpen(false);
        }}
        className={cn(
          "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-right text-white/80 transition hover:bg-white/10",
          active === null && "bg-white/10 text-white",
        )}
      >
        <span>إيقاف</span>
      </button>
      {subs.map((s) => (
        <button
          key={s.lang}
          onClick={() => {
            onPick(s.lang);
            setOpen(false);
          }}
          className={cn(
            "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-right text-white/80 transition hover:bg-white/10",
            active === s.lang && "bg-white/10 text-white",
          )}
        >
          <span>{s.label}</span>
          {s.default && <span className="text-[10px] text-[#A855F7]">افتراضي</span>}
        </button>
      ))}
    </MenuShell>
  );
}

function SettingsMenu({
  levels,
  levelIdx,
  onLevel,
  open,
  setOpen,
}: {
  levels: { index: number; height?: number; bitrate?: number }[];
  levelIdx: number;
  onLevel: (i: number) => void;
  open: boolean;
  setOpen: (b: boolean) => void;
}) {
  const active =
    levels.find((l) => l.index === levelIdx) ??
    (levelIdx === -1 ? { index: -1, label: "تلقائي" } : null);
  return (
    <MenuShell
      open={open}
      button={
        <button
          onClick={() => setOpen(!open)}
          className="grid size-9 place-items-center rounded-full text-white/85 hover:bg-white/10 hover:text-white"
          title="الإعدادات"
        >
          <SettingsIcon className="size-[18px]" />
        </button>
      }
    >
      <p className="px-2 py-1 text-[10.5px] font-bold uppercase tracking-widest text-white/40">
        الجودة
      </p>
      <button
        onClick={() => {
          onLevel(-1);
          setOpen(false);
        }}
        className={cn(
          "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-right text-white/80 transition hover:bg-white/10",
          levelIdx === -1 && "bg-white/10 text-white",
        )}
      >
        <span>تلقائي</span>
      </button>
      {levels.map((l) => (
        <button
          key={l.index}
          onClick={() => {
            onLevel(l.index);
            setOpen(false);
          }}
          className={cn(
            "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-right text-white/80 transition hover:bg-white/10",
            levelIdx === l.index && "bg-white/10 text-white",
          )}
        >
          <span>{l.height ? `${l.height}p` : `مستوى ${l.index + 1}`}</span>
          {l.bitrate ? (
            <span className="text-[10.5px] text-white/40">
              {Math.round((l.bitrate ?? 0) / 1000)}kbps
            </span>
          ) : null}
        </button>
      ))}
      {levels.length === 0 && (
        <p className="px-2 py-1.5 text-[11px] text-white/40">تلقائي فقط</p>
      )}
      {active && levelIdx !== -1 && (
        <p className="mt-1 flex items-center justify-between border-t border-white/10 px-2 py-1 text-[10.5px] text-white/45">
          <span>المختار</span>
          <span className="flex items-center gap-1 text-white/80">
            <ChevronDown className="size-3" />
            {active && "height" in active && active.height
              ? `${active.height}p`
              : `مستوى ${(active as { index: number }).index + 1}`}
          </span>
        </p>
      )}
    </MenuShell>
  );
}
