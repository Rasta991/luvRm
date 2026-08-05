import { motion } from "framer-motion";
import { Play, Plus, Check, Users, Info } from "lucide-react";
import { useState } from "react";
import type { Title } from "../data/catalog";
import { useRouter } from "../lib/router";
import { cn } from "../utils/cn";
import { Badge, Rating } from "./ui/Primitives";

export function MovieCard({
  item,
  index = 0,
  className,
}: {
  item: Title;
  index?: number;
  className?: string;
}) {
  const { navigate } = useRouter();
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  return (
    <motion.article
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay: Math.min(index * 0.045, 0.4), ease: [0.16, 1, 0.3, 1] }}
      className={cn("group relative shrink-0", className)}
    >
      <motion.div
        whileHover={{ scale: 1.055, y: -8 }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
        onClick={() => {
          // If the title is from TMDB we go straight to the room — that's
          // the primary CTA in this app. For static catalog items we still
          // want the title detail page.
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
        className="relative cursor-pointer overflow-hidden rounded-2xl border border-white/[0.07] bg-surface transition-shadow duration-500 group-hover:border-brand/45 group-hover:shadow-[0_24px_70px_-20px_rgba(168,85,247,0.75),0_0_0_1px_rgba(168,85,247,0.35)]"
      >
        <div className="relative aspect-[2/3] w-full overflow-hidden bg-[#15131d]">
          {!loaded && <div className="shimmer absolute inset-0" />}
          <img
            src={item.poster}
            alt={item.name}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            className={cn(
              "size-full object-cover transition-all duration-700 group-hover:scale-105",
              loaded ? "opacity-100" : "opacity-0",
            )}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#08070B] via-[#08070B]/25 to-transparent opacity-90" />
          <div className="absolute inset-0 bg-gradient-to-t from-brand-2/35 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

          <div className="absolute right-2.5 top-2.5 flex flex-col items-end gap-1.5">
            <Badge tone="quality">{item.quality}</Badge>
            {item.rating >= 8.8 && <Badge tone="brand">TOP</Badge>}
          </div>

          {/* hover actions */}
          <div className="absolute inset-x-2.5 bottom-2.5 translate-y-3 opacity-0 transition-all duration-400 group-hover:translate-y-0 group-hover:opacity-100">
            <div className="flex items-center gap-1.5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigate({
                    name: "room",
                    id: "RV-8842",
                    titleId: item.id,
                    mediaType: item.mediaType,
                    tmdbId: item.tmdbId,
                  });
                }}
                className="grid size-9 place-items-center rounded-full bg-white text-black shadow-lg transition hover:bg-brand hover:text-white"
                title="تشغيل"
              >
                <Play className="size-4 fill-current" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSaved((s) => !s);
                }}
                className="grid size-9 place-items-center rounded-full border border-white/25 bg-black/50 text-white backdrop-blur transition hover:border-brand hover:bg-brand/25"
                title="إضافة للمفضلة"
              >
                {saved ? <Check className="size-4" /> : <Plus className="size-4" />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigate({
                    name: "room",
                    id: "RV-8842",
                    titleId: item.id,
                    mediaType: item.mediaType,
                    tmdbId: item.tmdbId,
                  });
                }}
                className="grid size-9 place-items-center rounded-full border border-white/25 bg-black/50 text-white backdrop-blur transition hover:border-brand hover:bg-brand/25"
                title="مشاهدة مع الأصدقاء"
              >
                <Users className="size-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigate({ name: "title", id: item.id });
                }}
                className="ml-0 grid size-9 place-items-center rounded-full border border-white/25 bg-black/50 text-white backdrop-blur transition hover:border-brand hover:bg-brand/25"
                title="التفاصيل"
              >
                <Info className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      <div className="mt-2.5 px-0.5">
        <h3 className="truncate text-[13.5px] font-bold text-white/90 transition-colors group-hover:text-white">
          {item.name}
        </h3>
        <div className="mt-1 flex items-center gap-2 text-[11.5px] text-white/45">
          <Rating value={item.rating} className="text-[11.5px]" />
          <span>·</span>
          <span>{item.year || "—"}</span>
          <span>·</span>
          <span className="truncate">{item.mediaType === "tv" ? "مسلسل" : "فيلم"}</span>
        </div>
      </div>
    </motion.article>
  );
}
