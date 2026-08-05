import { AnimatePresence, motion } from "framer-motion";
import { Calendar, ChevronDown, Film, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  getSeasonDetails,
  TMDB_IMG,
  type TmdbSeason,
} from "../lib/tmdb";
import { cn } from "../utils/cn";

/**
 * Season + Episode picker drawer.
 *
 * Used by the RoomPage host controls. Fetches the full TMDB season
 * metadata on demand and renders a two-pane drawer: seasons on the
 * left, episodes on the right. Episodes show real stills + names
 * pulled from TMDB rather than placeholders.
 *
 * On `disabled = true` (non-host members) the picker degrades to a
 * read-only badge showing the host's current season/episode.
 */
export function EpisodePicker({
  open,
  onClose,
  tmdbId,
  numberOfSeasons,
  season,
  episode,
  disabled,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  tmdbId: number;
  numberOfSeasons: number;
  season: number;
  episode: number;
  /** When true (non-host), the picker is hidden and replaced with a badge. */
  disabled: boolean;
  onPick: (season: number, episode: number) => void;
}) {
  const [seasons, setSeasons] = useState<TmdbSeason[]>([]);
  const [activeSeason, setActiveSeason] = useState(season);
  const [loading, setLoading] = useState(false);

  // Load every season's metadata up-front. TMDB returns the season
  // list (with episode counts) lazily via /tv/{id}/season/{n}, but the
  // poster + name per season is well worth the few extra requests.
  useEffect(() => {
    if (!open || !tmdbId || disabled) return;
    let cancelled = false;
    setLoading(true);
    const tasks = Array.from({ length: Math.max(1, numberOfSeasons) }, (_, i) =>
      getSeasonDetails(tmdbId, i + 1).catch(() => null),
    );
    Promise.all(tasks).then((results) => {
      if (cancelled) return;
      const valid = results.filter((s): s is TmdbSeason => !!s);
      setSeasons(valid);
      setActiveSeason(season);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, tmdbId, numberOfSeasons, season, disabled]);

  const active = useMemo(
    () => seasons.find((s) => s.season_number === activeSeason) ?? null,
    [seasons, activeSeason],
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-md"
          />
          <div className="fixed inset-0 z-[81] grid place-items-center overflow-y-auto p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="glass relative w-full max-w-3xl overflow-hidden rounded-3xl shadow-2xl glow-brand"
            >
              <div className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-brand/25 blur-3xl" />
              <div className="flex items-center justify-between border-b border-white/[0.08] p-5">
                <div className="flex items-center gap-2">
                  <Film className="size-4 text-brand" />
                  <h3 className="font-display text-xl font-extrabold text-white">
                    اختر الموسم والحلقة
                  </h3>
                  <span className="text-[12px] text-white/45">
                    · {disabled ? "المضيف فقط" : "اسحب الجوانب للتنقل"}
                  </span>
                </div>
                <button
                  onClick={onClose}
                  className="grid size-9 place-items-center rounded-full text-white/60 transition hover:bg-white/5 hover:text-white"
                >
                  <X className="size-5" />
                </button>
              </div>

              <div className="grid max-h-[70vh] grid-cols-[180px_1fr] overflow-hidden md:grid-cols-[220px_1fr]">
                {/* seasons rail */}
                <aside className="thin-scrollbar max-h-[70vh] overflow-y-auto border-l border-white/[0.06] bg-white/[0.02] p-2">
                  {loading && seasons.length === 0 ? (
                    <div className="flex items-center gap-2 px-2 py-6 text-[12px] text-white/45">
                      <Loader2 className="size-4 animate-spin text-brand" />
                      جاري التحميل…
                    </div>
                  ) : seasons.length === 0 ? (
                    <div className="px-2 py-6 text-[12px] text-white/45">
                      لا توجد مواسم.
                    </div>
                  ) : (
                    seasons.map((s) => (
                      <button
                        key={s.season_number}
                        onClick={() => setActiveSeason(s.season_number)}
                        disabled={disabled}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-right transition",
                          activeSeason === s.season_number
                            ? "border border-brand/40 bg-brand/15 text-white"
                            : "border border-transparent text-white/65 hover:border-white/15 hover:bg-white/[0.04] hover:text-white",
                          disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                        )}
                      >
                        <div className="size-10 shrink-0 overflow-hidden rounded-lg bg-white/5">
                          {s.poster_path ? (
                            <img
                              src={TMDB_IMG.poster(s.poster_path, "w185")}
                              alt={s.name}
                              loading="lazy"
                              className="size-full object-cover"
                            />
                          ) : (
                            <div className="grid size-full place-items-center text-brand/60">
                              <Film className="size-4" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-bold text-white">
                            {s.name || `الموسم ${s.season_number}`}
                          </p>
                          <p className="truncate text-[10.5px] text-white/45">
                            {s.episode_count} حلقة
                          </p>
                        </div>
                      </button>
                    ))
                  )}
                </aside>

                {/* episodes pane */}
                <div className="thin-scrollbar max-h-[70vh] overflow-y-auto p-4">
                  {loading ? (
                    <div className="grid place-items-center py-16 text-white/45">
                      <Loader2 className="size-5 animate-spin text-brand" />
                    </div>
                  ) : !active ? (
                    <p className="py-10 text-center text-[13px] text-white/45">
                      اختر موسمًا لعرض الحلقات.
                    </p>
                  ) : active.episodes.length === 0 ? (
                    <p className="py-10 text-center text-[13px] text-white/45">
                      لا توجد حلقات لهذا الموسم.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="mb-3 flex items-center gap-2 text-[12px] text-white/55">
                        <Calendar className="size-3.5 text-brand" />
                        {active.name || `الموسم ${active.season_number}`} ·{" "}
                        {active.episodes.length} حلقة
                      </div>
                      {active.episodes.map((ep) => {
                        const isCurrent =
                          ep.season_number === season && ep.episode_number === episode;
                        return (
                          <button
                            key={ep.id}
                            disabled={disabled}
                            onClick={() => {
                              onPick(active.season_number, ep.episode_number);
                              onClose();
                            }}
                            className={cn(
                              "group flex w-full items-center gap-4 rounded-2xl border p-2.5 text-right transition",
                              isCurrent
                                ? "border-brand/60 bg-brand/15 shadow-[0_0_24px_-12px_rgba(168,85,247,0.9)]"
                                : "border-white/[0.06] bg-white/[0.03] hover:border-brand/40 hover:bg-brand/[0.06]",
                              disabled && "cursor-not-allowed opacity-50",
                            )}
                          >
                            <span className="w-7 text-center font-display text-base font-black text-white/35 group-hover:text-brand">
                              {ep.episode_number}
                            </span>
                            <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-xl sm:w-44">
                              {ep.still_path ? (
                                <img
                                  src={TMDB_IMG.backdrop(ep.still_path, "w780")}
                                  alt={ep.name}
                                  loading="lazy"
                                  className="size-full object-cover opacity-85 transition group-hover:opacity-100"
                                />
                              ) : (
                                <div className="grid size-full place-items-center bg-white/5 text-brand/60">
                                  <Film className="size-5" />
                                </div>
                              )}
                              {isCurrent && (
                                <span className="absolute inset-0 grid place-items-center bg-brand/40 text-[10px] font-black tracking-widest text-white">
                                  قيد المشاهدة
                                </span>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13.5px] font-bold text-white">
                                {ep.name || `الحلقة ${ep.episode_number}`}
                              </p>
                              <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-white/45">
                                {ep.overview || "لا يتوفر ملخص لهذه الحلقة."}
                              </p>
                            </div>
                            <span className="hidden shrink-0 text-[11px] text-white/40 sm:block">
                              {ep.runtime ? `${ep.runtime} د` : ""}
                              {ep.air_date ? ` · ${ep.air_date}` : ""}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Compact trigger chip used by the RoomPage host controls. */
export function EpisodeChip({
  season,
  episode,
  disabled,
  onClick,
}: {
  season: number;
  episode: number;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "المضيف فقط" : "اختر الموسم والحلقة"}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-2 text-[12px] font-bold text-white/80 transition",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:border-brand/50 hover:bg-brand/10 hover:text-white",
      )}
    >
      <Film className="size-3.5 text-brand" />
      <span>
        الموسم {season} · الحلقة {episode}
      </span>
      <ChevronDown className="size-3.5" />
    </button>
  );
}