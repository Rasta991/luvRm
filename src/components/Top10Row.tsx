import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Flame, Play } from "lucide-react";
import { TOP10, type Title } from "../data/catalog";
import { useRouter } from "../lib/router";
import { cn } from "../utils/cn";
import { useSlider } from "./ContentRow";
import { Badge } from "./ui/Primitives";

export function Top10Row({ items }: { items?: Title[] } = {}) {
  const { ref, atStart, atEnd, scrollBy } = useSlider();
  const { navigate } = useRouter();
  const list = items && items.length ? items.slice(0, 10) : TOP10;

  return (
    <motion.section
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="group/row relative py-8"
    >
      <div className="mb-5 flex items-end justify-between gap-4 px-4 sm:px-8 lg:px-14">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1">
            <Flame className="size-3.5 text-brand" />
            <span className="text-[11px] font-bold tracking-widest text-[#DDBBFF]">
              اليوم في بلدك
            </span>
          </div>
          <h2 className="font-display text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            Top 10
          </h2>
          <p className="mt-1 text-[13px] text-white/45">الأكثر مشاهدة خلال ٢٤ ساعة</p>
        </div>
        <div className="hidden gap-2 md:flex">
          <button
            onClick={() => scrollBy(-1)}
            disabled={atStart}
            className="glass grid size-10 place-items-center rounded-full text-white transition hover:border-brand/50 hover:bg-brand/20 disabled:opacity-30"
          >
            <ChevronRight className="size-5" />
          </button>
          <button
            onClick={() => scrollBy(1)}
            disabled={atEnd}
            className="glass grid size-10 place-items-center rounded-full text-white transition hover:border-brand/50 hover:bg-brand/20 disabled:opacity-30"
          >
            <ChevronLeft className="size-5" />
          </button>
        </div>
      </div>

      <div
        ref={ref}
        className="no-scrollbar flex gap-4 overflow-x-auto scroll-smooth px-4 pb-4 pt-2 sm:gap-6 sm:px-8 lg:px-14"
      >
        {list.map((item, i) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, scale: 0.94 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: Math.min(i * 0.05, 0.4) }}
            onClick={() => {
              if (item.tmdbId) {
                navigate({
                  name: "room",
                  id: "RV-8842",
                  titleId: item.id,
                  mediaType: item.mediaType,
                  tmdbId: item.tmdbId,
                });
              } else {
                navigate({ name: "title", id: item.id });
              }
            }}
            className="group/top relative flex shrink-0 cursor-pointer items-end"
          >
            <span
              className={cn(
                "hollow-number pointer-events-none select-none font-display font-black leading-[0.72]",
                "text-[7.5rem] sm:text-[9.5rem] lg:text-[11rem]",
                i === 9 ? "-mr-2 tracking-tighter" : "",
              )}
            >
              {i + 1}
            </span>
            <div className="relative -mr-6 w-[30vw] transition-transform duration-500 group-hover/top:-translate-y-2 sm:w-[22vw] md:w-[17vw] lg:w-[12.5vw] xl:w-[10.5vw]">
              <div className="relative aspect-[2/3] overflow-hidden rounded-2xl border border-white/[0.08] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] transition-all duration-500 group-hover/top:border-brand/50 group-hover/top:shadow-[0_26px_70px_-18px_rgba(168,85,247,0.7)]">
                <img
                  src={item.poster}
                  alt={item.name}
                  loading="lazy"
                  className="size-full object-cover transition-transform duration-700 group-hover/top:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-3">
                  <p className="truncate text-[12.5px] font-bold text-white">{item.name}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Badge tone="quality" className="scale-90 origin-right">
                      {item.quality}
                    </Badge>
                    <span className="text-[10.5px] text-white/50">{item.year}</span>
                  </div>
                </div>
                <div className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-400 group-hover/top:opacity-100">
                  <span className="grid size-12 place-items-center rounded-full bg-white/95 text-black shadow-2xl">
                    <Play className="size-5 fill-current" />
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}
