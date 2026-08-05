import { AnimatePresence, motion } from "framer-motion";
import { Info, Loader2, Play, Plus, Users, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { type Title } from "../data/catalog";
import { getTrending, tmdbToTitle } from "../lib/tmdb";
import { useRouter } from "../lib/router";
import { cn } from "../utils/cn";
import { Badge, Button, Rating } from "./ui/Primitives";

const DURATION = 8500;

const FALLBACK_BACKDROP =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 9'><rect width='16' height='9' fill='%23120625'/></svg>";

/**
 * Hero slider driven by TMDB's `/trending/all/week` endpoint.
 *
 * We grab the top ~12 trending items and rotate through them every
 * DURATION ms. The first 10 are used for the bullets; the carousel
 * still works even if fewer items come back (the loop modulo handles it).
 *
 * No `HERO_SLIDES` fixture — every backdrop, title, and overview is
 * fetched live. If the request fails or the API key is missing, we render
 * a quiet skeleton placeholder instead of crashing the page.
 */
export function Hero() {
  const [i, setI] = useState(0);
  const [muted, setMuted] = useState(true);
  const [slides, setSlides] = useState<Title[]>([]);
  const [loading, setLoading] = useState(true);
  const { navigate } = useRouter();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getTrending("all")
      .then((items) => {
        if (cancelled) return;
        // Only keep items with a backdrop; the slider needs imagery.
        const titles = items
          .filter((it) => !!it.backdrop_path)
          .slice(0, 12)
          .map((it) => tmdbToTitle(it, it.media_type === "tv" ? "tv" : "movie"));
        setSlides(titles);
      })
      .catch(() => {
        if (cancelled) return;
        setSlides([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (slides.length <= 1) return;
    const t = setTimeout(
      () => setI((v) => (v + 1) % slides.length),
      DURATION,
    );
    return () => clearTimeout(t);
  }, [i, slides.length]);

  // Loading state — show a shimmering dark backdrop, no text.
  if (loading) {
    return (
      <section className="relative grid h-[92vh] min-h-[560px] w-full place-items-center overflow-hidden bg-[#08070B]">
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_80%_10%,rgba(124,58,237,0.18),transparent_60%)]" />
        <div className="relative flex flex-col items-center gap-3 text-white/55">
          <Loader2 className="size-7 animate-spin text-brand/70" />
          <p className="text-[12px] tracking-widest">جاري تحميل الأكثر رواجًا…</p>
        </div>
      </section>
    );
  }

  // Empty state — no API key or no results.
  if (slides.length === 0) {
    return (
      <section className="relative grid h-[92vh] min-h-[560px] w-full place-items-center overflow-hidden bg-[#08070B]">
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_80%_10%,rgba(124,58,237,0.18),transparent_60%)]" />
        <p className="relative text-[14px] text-white/55">
          لا تتوفر بيانات الآن — تأكّد من ضبط VITE_TMDB_API_KEY.
        </p>
      </section>
    );
  }

  const slide = slides[i];

  return (
    <section className="relative h-[92vh] min-h-[560px] w-full overflow-hidden">
      {/* backdrop */}
      <AnimatePresence mode="sync">
        <motion.div
          key={slide.id + i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.4, ease: "easeInOut" }}
          className="absolute inset-0"
        >
          <img
            src={slide.backdrop || FALLBACK_BACKDROP}
            alt=""
            className="ken-burns size-full object-cover"
            fetchPriority="high"
            onError={(e) => {
              const el = e.currentTarget as HTMLImageElement;
              if (el.dataset.fb) return;
              el.dataset.fb = "1";
              el.src = FALLBACK_BACKDROP;
            }}
          />
        </motion.div>
      </AnimatePresence>

      {/* overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#08070B] via-[#08070B]/45 to-[#08070B]/70" />
      <div className="absolute inset-0 bg-gradient-to-l from-[#08070B] via-[#08070B]/55 to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_80%_10%,rgba(124,58,237,0.28),transparent_60%)]" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#08070B] to-transparent" />

      {/* content */}
      <div className="relative z-10 mx-auto flex h-full max-w-[1800px] flex-col justify-end px-4 pb-20 sm:px-8 lg:px-14 lg:pb-28">
        <AnimatePresence mode="wait">
          <motion.div
            key={slide.id}
            initial={{ opacity: 0, y: 34 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-2xl"
          >
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge tone="brand" className="px-2.5 py-1">
                ✦ رائج هذا الأسبوع
              </Badge>
              <Badge tone="quality" className="px-2.5 py-1">
                {slide.quality}
              </Badge>
              <span className="text-[11px] font-semibold tracking-widest text-white/50">
                {(slide.genres ?? []).join(" • ")}
              </span>
            </div>

            <h1 className="font-display text-4xl font-black leading-[1.05] tracking-tight text-white text-glow sm:text-6xl lg:text-7xl">
              {slide.name}
            </h1>
            <p className="mt-2 text-lg font-semibold text-brand/90 sm:text-xl">
              {slide.original}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-white/70">
              <Rating value={slide.rating} />
              <span className="text-white/25">|</span>
              <span>{slide.year || "—"}</span>
              <span className="text-white/25">|</span>
              <span>
                {slide.kind === "movie"
                  ? slide.runtime ?? "—"
                  : `${slide.seasons ?? "—"} مواسم`}
              </span>
              <span className="text-white/25">|</span>
              <span className="rounded border border-white/20 px-1.5 py-0.5 text-[11px]">
                +16
              </span>
              <span className="text-white/25">|</span>
              <span className="text-emerald-400/90">
                {slide.match ?? 90}% يناسبك
              </span>
            </div>

            <p className="mt-5 max-w-xl text-[14.5px] leading-relaxed text-white/65 sm:text-base">
              {slide.overview || "لا يتوفر وصف لهذا المحتوى بعد."}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                onClick={() =>
                  navigate({
                    name: "room",
                    id: "RV-8842",
                    mediaType: slide.mediaType,
                    tmdbId: slide.tmdbId,
                  })
                }
              >
                <Play className="size-[18px] fill-current" />
                مشاهدة الآن
              </Button>
              <Button
                size="lg"
                variant="glass"
                onClick={() =>
                  navigate({
                    name: "room",
                    id: "RV-8842",
                    mediaType: slide.mediaType,
                    tmdbId: slide.tmdbId,
                  })
                }
              >
                <Users className="size-[18px]" />
                مشاهدة مع الأصدقاء
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="!px-4"
                onClick={() => navigate({ name: "title", id: slide.id })}
                aria-label="المزيد"
              >
                <Info className="size-[18px]" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="!px-4"
                aria-label="إضافة للقائمة"
              >
                <Plus className="size-[18px]" />
              </Button>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* controls */}
        <div className="mt-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            {slides.map((s, idx) => (
              <button
                key={s.id}
                onClick={() => setI(idx)}
                className="group relative h-1 overflow-hidden rounded-full bg-white/15 transition-all"
                style={{ width: idx === i ? 56 : 22 }}
                aria-label={s.name}
              >
                {idx === i && (
                  <motion.span
                    key={i}
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: DURATION / 1000, ease: "linear" }}
                    className="absolute inset-y-0 right-0 block bg-gradient-to-l from-[#A855F7] to-[#E879F9]"
                  />
                )}
              </button>
            ))}
          </div>
          <button
            onClick={() => setMuted((m) => !m)}
            className={cn(
              "glass grid size-10 place-items-center rounded-full text-white/80 transition hover:text-white",
            )}
            aria-label="الصوت"
          >
            {muted ? (
              <VolumeX className="size-[18px]" />
            ) : (
              <Volume2 className="size-[18px]" />
            )}
          </button>
        </div>
      </div>
    </section>
  );
}