import { AnimatePresence, motion } from "framer-motion";
import { Captions, Check, ChevronDown, Languages, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../utils/cn";

export interface SubtitleLangOption {
  lang: string;
  label: string;
  /** True if this is the preferred Arabic track. */
  isArabic?: boolean;
}

export interface SubtitleToggleProps {
  /** Available subtitle tracks. Empty array hides the toggle. */
  tracks: SubtitleLangOption[];
  /** Currently-active lang, or null when subtitles are off. */
  activeLang: string | null;
  onChange: (lang: string | null) => void;
  /** Optional className for the outer wrapper. */
  className?: string;
  /** When true, suppresses auto-showing subtitles on mount. */
  suppressAutoShow?: boolean;
}

/**
 * One-click subtitle toggle.
 *
 * Designed for "Arabic-first" rooms. The native-label "AR" pill is
 * surfaced prominently; the menu behind it lists every other track.
 * Three states:
 *   - "off"    → only the toggle button is visible
 *   - "ar"     → toggle shows "AR" badge, subtitles are active
 *   - "other"  → toggle shows the active lang code
 *
 * The toggle is wrapped in a small popover (no library) so it stays
 * inside the player's toolbar without bleeding outside the player
 * container.
 */
export function SubtitleToggle({
  tracks,
  activeLang,
  onChange,
  className,
  suppressAutoShow,
}: SubtitleToggleProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Default to the Arabic track the first time tracks become available.
  // Honors `suppressAutoShow` so the parent can defer the auto-show
  // until the user clicks play.
  useEffect(() => {
    if (suppressAutoShow) return;
    if (activeLang !== null) return;
    if (tracks.length === 0) return;
    const arabic = tracks.find((t) => t.isArabic) ?? tracks[0];
    if (arabic) onChange(arabic.lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.length]);

  // Close the menu on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const isArabic = activeLang
    ? tracks.find((t) => t.lang === activeLang)?.isArabic
    : false;
  const activeLabel = activeLang
    ? tracks.find((t) => t.lang === activeLang)?.label ?? activeLang
    : null;

  const cycleOff = useCallback(() => {
    onChange(null);
    setOpen(false);
  }, [onChange]);

  if (tracks.length === 0) return null;

  return (
    <div
      ref={wrapperRef}
      className={cn("relative inline-flex", className)}
      dir="ltr"
      data-subtitles-active={activeLang ? "true" : "false"}
    >
      <button
        type="button"
        onClick={() => (activeLang ? onChange(null) : setOpen((o) => !o))}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-bold transition",
          activeLang
            ? "border-brand/60 bg-brand/15 text-white shadow-[0_0_14px_-4px_rgba(168,85,247,0.6)]"
            : "border-white/15 bg-white/[0.04] text-white/70 hover:border-white/30 hover:text-white",
        )}
        aria-label={activeLang ? `Subtitles on (${activeLabel})` : "Subtitles off"}
        title={activeLang ? `Subtitles: ${activeLabel}` : "Subtitles off"}
      >
        <Captions className="size-3.5" />
        {isArabic ? (
          <span className="font-display">AR</span>
        ) : activeLang ? (
          <span className="font-display uppercase">{activeLang}</span>
        ) : (
          <span className="text-[11px]">CC</span>
        )}
        <ChevronDown
          className={cn(
            "size-3 transition",
            open && "rotate-180",
          )}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-12 end-0 z-30 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#0c0a13]/95 shadow-2xl ring-1 ring-black/40 backdrop-blur-xl"
          >
            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-[10.5px] font-bold uppercase tracking-widest text-white/55">
              <Languages className="size-3.5" />
              Subtitles
            </div>
            <ul className="max-h-72 overflow-y-auto">
              <li>
                <button
                  type="button"
                  onClick={cycleOff}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-left text-[12.5px] transition hover:bg-white/10",
                    activeLang === null && "bg-white/10",
                  )}
                >
                  <span className="inline-flex items-center gap-2">
                    <X className="size-3.5" /> Off
                  </span>
                  {activeLang === null && <Check className="size-3.5" />}
                </button>
              </li>
              {tracks.map((t) => (
                <li key={t.lang}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(t.lang);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between px-3 py-2 text-left text-[12.5px] transition hover:bg-white/10",
                      activeLang === t.lang && "bg-white/10",
                    )}
                  >
                    <span className="inline-flex items-center gap-2">
                      {t.isArabic && (
                        <span className="rounded-full bg-brand/25 px-1.5 py-0.5 text-[9px] font-black text-brand">
                          AR
                        </span>
                      )}
                      {t.label}
                    </span>
                    {activeLang === t.lang && <Check className="size-3.5" />}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default SubtitleToggle;
