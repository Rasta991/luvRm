import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Calendar,
  Clock,
  Download,
  Heart,
  Layers,
  Loader2,
  Play,
  Plus,
  Share2,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ContentRow } from "../components/ContentRow";
import { Footer } from "../components/Footer";
import { Badge, Button, Rating } from "../components/ui/Primitives";
import { type MediaType, type Title } from "../data/catalog";
import { useRouter } from "../lib/router";
import {
  formatRuntime,
  getCredits,
  getDetails,
  getSimilar,
  tmdbDetailsToTitle,
  type TmdbCredit,
} from "../lib/tmdb";
import { cn } from "../utils/cn";

const TABS = ["نظرة عامة", "الحلقات", "طاقم العمل"] as const;

/**
 * Title details page. The `id` is treated as either:
 *   - a TMDB composite id ("movie-123" or "tv-456"), or
 *   - a plain id, in which case `mediaType` + `tmdbId` props are required.
 *
 * All data (title, overview, genres, runtime, cast, similar titles) is
 * fetched from TMDB — there is no local mock fallback.
 */
export function TitlePage({
  id,
  mediaType: routeMediaType,
  tmdbId: routeTmdbId,
}: {
  id: string;
  mediaType?: MediaType;
  tmdbId?: number;
}) {
  const { navigate, back } = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>("نظرة عامة");
  const [season, setSeason] = useState(1);
  const [fav, setFav] = useState(false);

  // Resolve media type + tmdbId from the route id when not passed explicitly.
  // "movie-123" / "tv-456" → mediaType + numeric id. Anything else falls back
  // to the explicit props passed from the router.
  const parsed = (() => {
    const m = id.match(/^(movie|tv)-(\d+)$/);
    if (m) return { mediaType: m[1] as MediaType, tmdbId: Number(m[2]) };
    return { mediaType: routeMediaType ?? "movie", tmdbId: routeTmdbId ?? 0 };
  })();

  const [details, setDetails] = useState<Awaited<ReturnType<typeof getDetails>>>(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [credits, setCredits] = useState<TmdbCredit | null>(null);
  const [similar, setSimilar] = useState<Title[]>([]);

  useEffect(() => {
    let cancelled = false;
    setDetailsLoading(true);
    Promise.all([
      getDetails(parsed.mediaType, parsed.tmdbId || undefined),
      getCredits(parsed.mediaType, parsed.tmdbId || undefined).catch(() => null),
      getSimilar(parsed.mediaType, parsed.tmdbId || undefined).catch(() => []),
    ])
      .then(([d, c, sim]) => {
        if (cancelled) return;
        setDetails(d);
        setCredits(c);
        setSimilar(
          sim
            .filter((it) => !!it.backdrop_path)
            .slice(0, 12)
            .map((it) => tmdbDetailsToTitle(it, parsed.mediaType)),
        );
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
  }, [parsed.mediaType, parsed.tmdbId]);

  // Loading state — single skeleton card.
  if (detailsLoading && !details) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-white/55">
        <div className="flex items-center gap-3">
          <Loader2 className="size-6 animate-spin text-brand" />
          <p className="text-[13px]">جاري تحميل التفاصيل…</p>
        </div>
      </div>
    );
  }

  if (!details) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-white/55">
        <p className="text-[13px]">تعذّر العثور على بيانات لهذا المحتوى.</p>
      </div>
    );
  }

  const item = tmdbDetailsToTitle(details, parsed.mediaType);
  const isSeries = parsed.mediaType === "tv";
  const tabs = (isSeries ? TABS : TABS.filter((t) => t !== "الحلقات")) as readonly (typeof TABS)[number][];

  // Cast from TMDB credits.
  const cast = (credits?.cast ?? []).slice(0, 12).map((c) => ({
    name: c.name,
    role: c.character || "—",
    avatar: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
  }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* backdrop */}
      <div className="relative h-[62vh] min-h-[430px] w-full overflow-hidden">
        <motion.img
          initial={{ scale: 1.12 }}
          animate={{ scale: 1 }}
          transition={{ duration: 2.2, ease: "easeOut" }}
          src={item.backdrop}
          alt=""
          className="size-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#08070B] via-[#08070B]/55 to-[#08070B]/60" />
        <div className="absolute inset-0 bg-[radial-gradient(100%_70%_at_75%_0%,rgba(124,58,237,0.3),transparent_65%)]" />
        <button
          onClick={back}
          className="glass absolute right-4 top-24 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] text-white/85 transition hover:text-white sm:right-8 lg:right-14"
        >
          <ArrowRight className="size-4" /> رجوع
        </button>
      </div>

      {/* main */}
      <div className="relative z-10 mx-auto -mt-56 max-w-[1800px] px-4 sm:px-8 lg:px-14">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.6 }}
            className="w-40 shrink-0 sm:w-52 lg:w-64"
          >
            <div className="overflow-hidden rounded-3xl border border-white/10 shadow-[0_30px_80px_-30px_rgba(0,0,0,1)] glow-brand">
              <img src={item.poster} alt={item.name} className="aspect-[2/3] w-full object-cover" />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.6 }}
            className="min-w-0 flex-1 pb-2"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone="brand">✦ حصري</Badge>
              <Badge tone="quality">{item.quality}</Badge>
              <Badge>
                {parsed.mediaType === "tv" ? "مسلسل" : "فيلم"}
              </Badge>
            </div>
            <h1 className="font-display text-3xl font-black leading-tight tracking-tight text-white text-glow sm:text-5xl lg:text-6xl">
              {item.name}
            </h1>
            {item.original && item.original !== item.name && (
              <p className="mt-2 text-lg font-semibold text-brand/90">{item.original}</p>
            )}
            {item.tagline && (
              <p className="mt-1 text-[13px] italic text-white/40">« {item.tagline} »</p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-white/65">
              <Rating value={item.rating} />
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="size-3.5 text-brand" /> {item.year || "—"}
              </span>
              {formatRuntime(details.runtime) !== "—" && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-3.5 text-brand" /> {formatRuntime(details.runtime)}
                </span>
              )}
              {isSeries && item.seasons && (
                <span className="inline-flex items-center gap-1.5">
                  <Layers className="size-3.5 text-brand" /> {item.seasons} مواسم
                  {item.episodes ? ` · ${item.episodes} حلقة` : ""}
                </span>
              )}
              <span className="text-emerald-400/90">{item.match}% يناسبك</span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {item.genres.map((g) => (
                <span
                  key={g}
                  className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-[12px] text-white/65"
                >
                  {g}
                </span>
              ))}
            </div>

            <p className="mt-5 max-w-3xl text-[14.5px] leading-relaxed text-white/60">
              {item.overview || "لا يتوفر وصف لهذا المحتوى بعد."}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                onClick={() =>
                  navigate({
                    name: "room",
                    id: "RV-8842",
                    titleId: item.id,
                    mediaType: parsed.mediaType,
                    tmdbId: parsed.tmdbId,
                  })
                }
              >
                <Play className="size-5 fill-current" /> تشغيل
              </Button>
              <Button
                size="lg"
                variant="glass"
                onClick={() =>
                  navigate({
                    name: "room",
                    id: "RV-8842",
                    titleId: item.id,
                    mediaType: parsed.mediaType,
                    tmdbId: parsed.tmdbId,
                  })
                }
              >
                <Users className="size-[18px]" /> مشاهدة مع الأصدقاء
              </Button>
              <Button size="lg" variant="outline" onClick={() => setFav((f) => !f)}>
                {fav ? (
                  <Heart className="size-[18px] fill-brand text-brand" />
                ) : (
                  <Plus className="size-[18px]" />
                )}
                {fav ? "في قائمتي" : "قائمتي"}
              </Button>
              <Button size="lg" variant="outline" className="!px-4">
                <Share2 className="size-[18px]" />
              </Button>
              <Button size="lg" variant="outline" className="!px-4">
                <Download className="size-[18px]" />
              </Button>
            </div>
          </motion.div>
        </div>

        {/* tabs */}
        <div className="mt-12 border-b border-white/[0.08]">
          <div className="no-scrollbar flex gap-1 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "relative shrink-0 px-4 py-3 text-[14px] font-semibold transition-colors",
                  tab === t ? "text-white" : "text-white/45 hover:text-white/80",
                )}
              >
                {t}
                {tab === t && (
                  <motion.span
                    layoutId="tab-underline"
                    className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-gradient-to-l from-[#A855F7] to-[#E879F9]"
                  />
                )}
              </button>
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35 }}
            className="py-8"
          >
            {tab === "نظرة عامة" && (
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="rounded-2xl border border-white/[0.07] bg-surface/70 p-5 backdrop-blur transition hover:border-brand/30">
                  <h4 className="mb-2 text-[14px] font-bold text-white">القصة</h4>
                  <p className="text-[13.5px] leading-relaxed text-white/50">
                    {item.overview || "لا يتوفر وصف لهذا المحتوى بعد."}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/[0.07] bg-surface/70 p-5 backdrop-blur transition hover:border-brand/30">
                  <h4 className="mb-2 text-[14px] font-bold text-white">الجودة والصوت</h4>
                  <p className="text-[13.5px] leading-relaxed text-white/50">
                    متاح بجودة {item.quality} مع ترجمة عربية وإنجليزية، ودبلجة عربية فصحى عند توفّرها.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/[0.07] bg-surface/70 p-5 backdrop-blur transition hover:border-brand/30">
                  <h4 className="mb-2 text-[14px] font-bold text-white">تفاصيل الإنتاج</h4>
                  <p className="text-[13.5px] leading-relaxed text-white/50">
                    إنتاج luvinRm Originals · {item.year || "—"} · تصنيف عمري +16 ·{" "}
                    {item.genres.join("، ") || "—"} · اللغة الأصلية: {details.original_language?.toUpperCase() || "—"}.
                  </p>
                </div>
              </div>
            )}

            {tab === "الحلقات" && isSeries && (
              <div>
                <div className="mb-5 flex flex-wrap gap-2">
                  {Array.from({ length: item.seasons ?? 1 }, (_, s) => (
                    <button
                      key={s}
                      onClick={() => setSeason(s + 1)}
                      className={cn(
                        "rounded-full border px-4 py-2 text-[13px] font-semibold transition",
                        season === s + 1
                          ? "border-brand/60 bg-brand/15 text-white"
                          : "border-white/10 text-white/50 hover:border-white/25 hover:text-white",
                      )}
                    >
                      الموسم {s + 1}
                    </button>
                  ))}
                </div>
                <div className="space-y-3">
                  {Array.from({ length: Math.min(item.episodes ?? 8, 10) }, (_, e) => (
                    <motion.button
                      key={e}
                      onClick={() =>
                        navigate({
                          name: "room",
                          id: "RV-8842",
                          titleId: item.id,
                          mediaType: parsed.mediaType,
                          tmdbId: parsed.tmdbId,
                        })
                      }
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: e * 0.05 }}
                      className="group flex w-full items-center gap-4 rounded-2xl border border-white/[0.06] bg-surface/60 p-3 text-right transition hover:border-brand/35 hover:bg-brand/[0.06]"
                    >
                      <span className="w-6 text-center font-display text-lg font-black text-white/25 group-hover:text-brand">
                        {e + 1}
                      </span>
                      <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-xl sm:w-44">
                        <img
                          src={item.backdrop}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover opacity-80"
                        />
                        <span className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition group-hover:opacity-100">
                          <Play className="size-6 fill-white text-white" />
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-bold text-white">
                          الحلقة {e + 1}
                          {item.tagline ? ` — ${item.tagline}` : ""}
                        </p>
                        <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-white/45">
                          {item.overview || "—"}
                        </p>
                      </div>
                      <span className="hidden shrink-0 text-[12px] text-white/35 sm:block">
                        {38 + ((e * 7) % 20)} د
                      </span>
                    </motion.button>
                  ))}
                </div>
              </div>
            )}

            {tab === "طاقم العمل" && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {cast.length === 0 ? (
                  <p className="col-span-full text-center text-[13px] text-white/45">
                    لا يتوفر طاقم عمل لهذا المحتوى.
                  </p>
                ) : (
                  cast.map((c, i) => (
                    <motion.div
                      key={`${c.name}-${i}`}
                      initial={{ opacity: 0, y: 18 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.06 }}
                      className="rounded-2xl border border-white/[0.07] bg-surface/70 p-4 text-center transition hover:border-brand/35"
                    >
                      <img
                        src={
                          c.avatar ||
                          `https://ui-avatars.com/api/?name=${encodeURIComponent(c.name)}&background=7C3AED&color=fff&size=160`
                        }
                        alt={c.name}
                        loading="lazy"
                        className="mx-auto size-16 rounded-full object-cover ring-2 ring-brand/40"
                      />
                      <p className="mt-3 text-[13.5px] font-bold text-white">{c.name}</p>
                      <p className="mt-0.5 text-[11.5px] text-white/40">{c.role}</p>
                    </motion.div>
                  ))
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="pb-6">
        <ContentRow title="More Like This" subtitle="مقترحات تشبه ما تشاهده" items={similar} />
      </div>
      <Footer />
    </motion.div>
  );
}