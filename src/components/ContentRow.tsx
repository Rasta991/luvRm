import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Title } from "../data/catalog";
import { cn } from "../utils/cn";
import { MovieCard } from "./MovieCard";
import { SectionHeading } from "./ui/Primitives";

/** Skeleton card used while a TMDB row is loading. */
function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03]",
        className,
      )}
    >
      <div className="shimmer aspect-[2/3] w-full" />
      <div className="space-y-1.5 p-2.5">
        <div className="shimmer h-3 w-3/4 rounded" />
        <div className="shimmer h-2.5 w-1/2 rounded" />
      </div>
    </div>
  );
}

export const CARD_W =
  "w-[43vw] sm:w-[27vw] md:w-[22vw] lg:w-[17vw] xl:w-[14.2vw] 2xl:w-[12.5vw]";

export function useSlider() {
  const ref = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const pos = Math.abs(el.scrollLeft);
    setAtStart(pos < 8);
    setAtEnd(pos > max - 8);
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update]);

  const scrollBy = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const amount = el.clientWidth * 0.82;
    // RTL: forward (dir=1) means decreasing scrollLeft
    el.scrollBy({ left: -dir * amount, behavior: "smooth" });
  };

  return { ref, atStart, atEnd, scrollBy };
}

function ArrowBtn({
  side,
  onClick,
  disabled,
}: {
  side: "left" | "right";
  onClick: () => void;
  disabled?: boolean;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "absolute top-0 z-20 hidden h-[calc(100%-3.2rem)] w-12 place-items-center transition-all duration-300 md:grid",
        side === "left" ? "left-0" : "right-0",
        disabled ? "pointer-events-none opacity-0" : "opacity-0 group-hover/row:opacity-100",
      )}
      aria-label={side === "left" ? "التالي" : "السابق"}
    >
      <span
        className={cn(
          "absolute inset-0",
          side === "left"
            ? "bg-gradient-to-r from-[#08070B] to-transparent"
            : "bg-gradient-to-l from-[#08070B] to-transparent",
        )}
      />
      <span className="glass relative grid size-10 place-items-center rounded-full text-white shadow-xl transition hover:scale-110 hover:border-brand/50 hover:bg-brand/25">
        <Icon className="size-5" />
      </span>
    </button>
  );
}

export function ContentRow({
  title,
  subtitle,
  items,
  fetcher,
  skeletonCount = 8,
}: {
  title: string;
  subtitle?: string;
  items?: Title[];
  /**
   * Optional async fetcher. When provided, the row will fetch its own data
   * (so callers can wire multiple TMDB rows without passing every list down
   * through props) and show a skeleton placeholder while loading.
   */
  fetcher?: () => Promise<Title[]>;
  skeletonCount?: number;
}) {
  const { ref, atStart, atEnd, scrollBy } = useSlider();
  const [remote, setRemote] = useState<Title[] | null>(null);
  const [loading, setLoading] = useState<boolean>(!!fetcher);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    if (!fetcher) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetcher()
      .then((data) => {
        if (cancelled) return;
        setRemote(data);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher]);

  const list = items ?? remote ?? [];
  const isLoading = fetcher ? loading && list.length === 0 : false;
  const isEmpty = !isLoading && list.length === 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="group/row relative py-5"
    >
      <div className="px-4 sm:px-8 lg:px-14">
        <SectionHeading
          title={title}
          subtitle={error ? "تعذّر التحميل" : subtitle}
          action={
            <button className="hidden shrink-0 items-center gap-1 text-[12.5px] font-semibold text-white/45 transition hover:text-brand sm:flex">
              عرض الكل
              <ChevronLeft className="size-4" />
            </button>
          }
        />
      </div>

      <div className="relative">
        {!isEmpty && (
          <>
            <ArrowBtn side="right" onClick={() => scrollBy(-1)} disabled={atStart} />
            <ArrowBtn side="left" onClick={() => scrollBy(1)} disabled={atEnd} />
          </>
        )}
        <div
          ref={ref}
          className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pb-2 sm:gap-4 sm:px-8 lg:px-14"
        >
          {isLoading &&
            Array.from({ length: skeletonCount }).map((_, i) => (
              <SkeletonCard key={`s-${i}`} className={cn(CARD_W, "snap-start")} />
            ))}
          {!isLoading &&
            list.map((item, i) => (
              <MovieCard
                key={item.id + i}
                item={item}
                index={i}
                className={cn(CARD_W, "snap-start")}
              />
            ))}
          {isEmpty && (
            <div className="px-4 py-8 text-[13px] text-white/40 sm:px-8 lg:px-14">
              لا يوجد محتوى متاح الآن.
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}
