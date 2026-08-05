import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { ChannelsApps } from "../components/ChannelsApps";
import { ContentRow } from "../components/ContentRow";
import { Footer } from "../components/Footer";
import { Hero } from "../components/Hero";
import { Top10Row } from "../components/Top10Row";
import { RowSkeleton, Button } from "../components/ui/Primitives";
import { type Title } from "../data/catalog";
import { useRouter } from "../lib/router";
import {
  GENRES,
  PROVIDERS,
  discoverByGenre,
  discoverByProvider,
  getAiringToday,
  getArabic,
  getNowPlaying,
  getOnTheAir,
  getPopular,
  getTopRated,
  getTrending,
  getUpcoming,
  tmdbToTitle,
} from "../lib/tmdb";
import { Play, Users } from "lucide-react";

/**
 * "متابعة المشاهدة" row — driven by real watch history stored in
 * localStorage plus a TMDB popular fallback when there's no history yet.
 *
 * The shape stored in localStorage is intentionally trivial:
 *
 *     { tmdbId: number; mediaType: "movie" | "tv"; progress: number; ts: number; title?: string; backdrop?: string; kind?: "movie"|"series"|"anime"|"cartoon" }
 *
 * We only keep what the card UI needs (title + backdrop), so a history
 * entry stays tiny and the row is instant.
 */
function ContinueWatching() {
  const { navigate } = useRouter();
  const [items, setItems] = useState<Title[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      // 1. Read watch history from localStorage (if any).
      let historyTitles: Title[] = [];
      try {
        const raw = localStorage.getItem("luvinrm.watchHistory");
        if (raw) {
          const parsed = JSON.parse(raw) as Array<{
            tmdbId: number;
            mediaType: "movie" | "tv";
            progress?: number;
            ts?: number;
            title?: string;
            backdrop?: string;
            kind?: Title["kind"];
          }>;
          // Most-recent first.
          parsed.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
          historyTitles = parsed.slice(0, 6).map((h) => ({
            id: `${h.mediaType}-${h.tmdbId}`,
            name: h.title || "—",
            original: h.title || "—",
            year: 0,
            rating: 0,
            quality: "FHD",
            kind: h.kind ?? (h.mediaType === "tv" ? "series" : "movie"),
            mediaType: h.mediaType,
            genres: [],
            tags: [],
            poster: h.backdrop || "",
            backdrop: h.backdrop || "",
            tagline: "",
            overview: "",
            cast: [],
            match: 90,
            tmdbId: h.tmdbId,
            seasons: h.mediaType === "tv" ? 1 : undefined,
          }));
        }
      } catch {
        // localStorage might be blocked (privacy mode) — fall through.
      }

      // 2. If we don't have enough history, hydrate with TMDB popular.
      if (historyTitles.length < 4) {
        const popular = await getPopular("movie").catch(() => []);
        if (cancelled) return;
        const popularTitles = popular
          .filter((it) => !!it.backdrop_path)
          .slice(0, 6 - historyTitles.length)
          .map((it) => tmdbToTitle(it, "movie"));
        historyTitles = [...historyTitles, ...popularTitles];
      }
      if (cancelled) return;
      setItems(historyTitles);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading && items.length === 0) return null;

  return (
    <section className="relative -mt-6 px-4 pb-2 sm:px-8 lg:px-14">
      <h2 className="mb-4 font-display text-xl font-extrabold tracking-tight text-white sm:text-2xl">
        متابعة المشاهدة
      </h2>
      <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
        {items.map((t, i) => (
          <motion.button
            key={t.id}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.45, delay: i * 0.05 }}
            whileHover={{ scale: 1.03, y: -4 }}
            onClick={() =>
              navigate({
                name: "room",
                id: "RV-8842",
                mediaType: t.mediaType,
                tmdbId: t.tmdbId,
              })
            }
            className="group relative aspect-video w-[68vw] shrink-0 overflow-hidden rounded-2xl border border-white/[0.07] bg-surface text-right transition hover:border-brand/40 hover:shadow-[0_20px_60px_-24px_rgba(168,85,247,0.8)] sm:w-[42vw] lg:w-[26vw] xl:w-[21vw]"
          >
            {t.backdrop && (
              <img
                src={t.backdrop}
                alt={t.name}
                loading="lazy"
                className="size-full object-cover opacity-70 transition duration-700 group-hover:scale-105 group-hover:opacity-90"
              />
            )}
            <span className="absolute inset-0 bg-gradient-to-t from-[#08070B] via-[#08070B]/25 to-transparent" />
            <span className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100">
              <span className="grid size-12 place-items-center rounded-full bg-white/95 text-black shadow-xl">
                <Play className="size-5 fill-current" />
              </span>
            </span>
            <span className="absolute inset-x-0 bottom-0 p-3.5">
              <span className="block truncate text-[13.5px] font-bold text-white">{t.name}</span>
              <span className="mt-0.5 block text-[11px] text-white/50">
                {t.kind === "movie"
                  ? "متابعة الفيلم"
                  : `الموسم ${t.seasons ?? 1} · الحلقة ${3 + i}`}
              </span>
              <span className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-white/15">
                <span
                  className="block h-full rounded-full bg-gradient-to-l from-[#A855F7] to-[#E879F9]"
                  style={{ width: `${25 + i * 11}%` }}
                />
              </span>
            </span>
          </motion.button>
        ))}
      </div>
    </section>
  );
}

function RoomsBanner({ onCreate }: { onCreate: () => void }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6 }}
      className="px-4 py-10 sm:px-8 lg:px-14"
    >
      <div className="relative overflow-hidden rounded-3xl border border-brand/25 bg-gradient-to-l from-[#150F26] via-[#1A0F2E] to-[#0C0A14] p-8 sm:p-12">
        <div className="pointer-events-none absolute -top-24 left-10 size-72 rounded-full bg-brand/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 right-0 size-80 rounded-full bg-fuchsia-600/15 blur-3xl" />
        <div className="relative flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
          <div className="max-w-xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand/40 bg-brand/15 px-3 py-1 text-[11px] font-bold tracking-widest text-[#E4CCFF]">
              <span className="pulse-dot size-1.5 rounded-full bg-brand" />
              RAVE ROOMS
            </span>
            <h3 className="mt-4 font-display text-3xl font-black leading-tight text-white sm:text-4xl">
              شاهدوا معًا. بنفس اللحظة.
            </h3>
            <p className="mt-3 text-[14.5px] leading-relaxed text-white/55">
              تشغيل متزامن بدقة الميلي ثانية، دردشة حية، ردود فعل بالإيموجي، وحتى ٥٠ صديقًا في غرفة
              واحدة — بجودة 4K بدون تأخير.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button size="lg" onClick={onCreate}>
                <Users className="size-[18px]" /> أنشئ غرفتك الآن
              </Button>
              <Button size="lg" variant="glass">
                انضم بكود
              </Button>
            </div>
          </div>
          <div className="flex -space-x-3 space-x-reverse">
            {[5, 12, 24, 33, 47, 58].map((n, i) => (
              <motion.img
                key={n}
                initial={{ opacity: 0, scale: 0.6 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 + i * 0.08, type: "spring", stiffness: 260 }}
                src={`https://i.pravatar.cc/120?img=${n}`}
                alt=""
                className="size-14 rounded-full border-2 border-[#12101B] object-cover shadow-xl sm:size-16"
              />
            ))}
            <div className="grid size-14 place-items-center rounded-full border-2 border-[#12101B] bg-brand text-[13px] font-black text-white sm:size-16">
              +42
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

/**
 * Small helper so we can write each row as a plain object without repeating
 * the fetcher wrapper. Returns a fetcher that converts TMDB results to
 * Title[].
 */
const makeFetcher =
  (path: () => Promise<unknown[]>, media: "movie" | "tv") => () =>
    path().then((rows) => rows.map((r) => tmdbToTitle(r as never, media)));

export function Home({ onCreateRoom }: { onCreateRoom: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 650);
    return () => clearTimeout(t);
  }, []);

  // Pre-build fetcher closures so the rows can re-fetch on remount without
  // recreating the same Promise chain twice.
  const fetchers = useMemo(
    () => ({
      trending: makeFetcher(() => getTrending("all"), "movie"),
      topMovies: makeFetcher(() => getTopRated("movie"), "movie"),
      trendingSeries: makeFetcher(() => getTrending("tv"), "tv"),
      popularSeries: makeFetcher(() => getPopular("tv"), "tv"),
      topSeries: makeFetcher(() => getTopRated("tv"), "tv"),
      nowPlaying: makeFetcher(() => getNowPlaying(), "movie"),
      upcoming: makeFetcher(() => getUpcoming(), "movie"),
      onTheAir: makeFetcher(() => getOnTheAir(), "tv"),
      airingToday: makeFetcher(() => getAiringToday(), "tv"),
      arabic: makeFetcher(() => getArabic("movie"), "movie"),
      arabicSeries: makeFetcher(() => getArabic("tv"), "tv"),
      netflix: makeFetcher(() => discoverByProvider("movie", PROVIDERS.netflix), "movie"),
      disney: makeFetcher(() => discoverByProvider("movie", PROVIDERS.disney), "movie"),
      apple: makeFetcher(() => discoverByProvider("movie", PROVIDERS.apple), "movie"),
      hbomax: makeFetcher(() => discoverByProvider("tv", PROVIDERS.hboMax), "tv"),
      action: makeFetcher(() => discoverByGenre("movie", GENRES.action), "movie"),
      comedy: makeFetcher(() => discoverByGenre("movie", GENRES.comedy), "movie"),
      horror: makeFetcher(() => discoverByGenre("movie", GENRES.horror), "movie"),
      scifi: makeFetcher(() => discoverByGenre("movie", GENRES.scifi), "movie"),
      romance: makeFetcher(() => discoverByGenre("movie", GENRES.romance), "movie"),
      drama: makeFetcher(() => discoverByGenre("movie", GENRES.drama), "movie"),
      thriller: makeFetcher(() => discoverByGenre("movie", GENRES.thriller), "movie"),
      anime: makeFetcher(() => discoverByGenre("tv", GENRES.animeTV), "tv"),
      cartoon: makeFetcher(() => discoverByGenre("tv", GENRES.cartoonTV), "tv"),
      family: makeFetcher(() => discoverByGenre("movie", GENRES.family), "movie"),
      fantasy: makeFetcher(() => discoverByGenre("movie", GENRES.fantasy), "movie"),
    }),
    [],
  );

  // Top 10 is driven by TMDB trending so the row shows real popular titles.
  const [top10, setTop10] = useState<Title[]>([]);
  useEffect(() => {
    let cancelled = false;
    getTrending("all").then((rows) => {
      if (cancelled) return;
      setTop10(rows.slice(0, 10).map((r) => tmdbToTitle(r as never)));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <Hero />
      <div className="relative z-10 -mt-14 space-y-1 pb-8">
        <ContinueWatching />
        {!ready ? (
          <div className="space-y-10 py-8">
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : (
          <>
            <ContentRow
              title="الرائج هذا الأسبوع"
              subtitle="الأكثر بحثًا على المنصة"
              fetcher={fetchers.trending}
            />
            <Top10Row items={top10} />

            {/* Streaming platforms — explicit provider discover rows */}
            <section className="px-4 sm:px-8 lg:px-14">
              <h2 className="font-display text-xl font-extrabold tracking-tight text-white sm:text-2xl">
                منصّات البث
              </h2>
              <p className="mt-1 text-[12.5px] text-white/45">
                أفلام ومسلسلات من أبرز المنصّات العالمية
              </p>
            </section>
            <ContentRow
              title="Netflix Originals"
              subtitle="حصريات نتفلكس"
              fetcher={fetchers.netflix}
            />
            <ContentRow
              title="Disney+ Collection"
              subtitle="عالم ديزني وعروضه"
              fetcher={fetchers.disney}
            />
            <ContentRow
              title="Apple TV+"
              subtitle="أعمال Apple TV+ الأصلية"
              fetcher={fetchers.apple}
            />
            <ContentRow
              title="HBO Max"
              subtitle="أقوى مسلسلات HBO"
              fetcher={fetchers.hbomax}
            />

            <ContentRow
              title="أفلام في السينما الآن"
              subtitle="العروض الحالية في الصالات"
              fetcher={fetchers.nowPlaying}
            />
            <ContentRow
              title="قريبًا"
              subtitle="أفلام قادمة هذا الموسم"
              fetcher={fetchers.upcoming}
            />
            <ContentRow
              title="مسلسلات على الهواء"
              subtitle="حلقات جديدة هذا الأسبوع"
              fetcher={fetchers.onTheAir}
            />
            <ContentRow
              title="بثّ مباشر اليوم"
              subtitle="حلقات تبثّ اليوم"
              fetcher={fetchers.airingToday}
            />

            <ContentRow
              title="الأعلى تقييمًا — أفلام"
              subtitle="روائع السينما على مرّ التاريخ"
              fetcher={fetchers.topMovies}
            />
            <ContentRow
              title="الأعلى تقييمًا — مسلسلات"
              subtitle="الأعمال التلفزيونية الأعلى تقييمًا"
              fetcher={fetchers.topSeries}
            />
            <ContentRow
              title="الأكثر شعبية — مسلسلات"
              subtitle="ما يشاهده الجميع الآن"
              fetcher={fetchers.popularSeries}
            />
            <ContentRow
              title="مسلسلات رائجة"
              subtitle="أحدث ما يتابعه العالم"
              fetcher={fetchers.trendingSeries}
            />

            <ContentRow
              title="محتوى عربي"
              subtitle="أعمال من العالم العربي"
              fetcher={fetchers.arabic}
            />
            <ContentRow
              title="مسلسلات عربية"
              subtitle="إنتاجات عربية مختارة"
              fetcher={fetchers.arabicSeries}
            />

            <ContentRow
              title="أنمي"
              subtitle="عوالم بلا حدود"
              fetcher={fetchers.anime}
            />
            <ContentRow
              title="كرتون"
              subtitle="متعة لكل العائلة"
              fetcher={fetchers.cartoon}
            />

            <ChannelsApps />
            <RoomsBanner onCreate={onCreateRoom} />

            <ContentRow
              title="أكشن"
              subtitle="أدرينالين خالص"
              fetcher={fetchers.action}
            />
            <ContentRow
              title="كوميديا"
              subtitle="ضحك بلا توقف"
              fetcher={fetchers.comedy}
            />
            <ContentRow
              title="رعب"
              subtitle="لا تشاهدها وحدك"
              fetcher={fetchers.horror}
            />
            <ContentRow
              title="خيال علمي"
              subtitle="المستقبل بدأ للتو"
              fetcher={fetchers.scifi}
            />
            <ContentRow
              title="رومانسي"
              subtitle="قصص تبقى معك"
              fetcher={fetchers.romance}
            />
            <ContentRow
              title="دراما"
              subtitle="قصص إنسانية عميقة"
              fetcher={fetchers.drama}
            />
            <ContentRow
              title="إثارة"
              subtitle="توتّر بلا توقف"
              fetcher={fetchers.thriller}
            />
            <ContentRow
              title="عائلي"
              subtitle="شاشة واحدة تجمع الجميع"
              fetcher={fetchers.family}
            />
            <ContentRow
              title="فانتازيا"
              subtitle="عوالم خيالية ساحرة"
              fetcher={fetchers.fantasy}
            />
          </>
        )}
      </div>
      <Footer />
    </motion.div>
  );
}
