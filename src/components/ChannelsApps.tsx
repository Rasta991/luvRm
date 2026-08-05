import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { CHANNELS } from "../data/catalog";
import { SectionHeading } from "./ui/Primitives";

export function ChannelsApps() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="relative py-10"
    >
      <div className="px-4 sm:px-8 lg:px-14">
        <SectionHeading
          title="Channels & Apps"
          subtitle="كل منصاتك المفضلة في مكان واحد"
          action={
            <button className="hidden items-center gap-1 text-[12.5px] font-semibold text-white/45 transition hover:text-brand sm:flex">
              إدارة الاشتراكات
              <ArrowLeft className="size-4" />
            </button>
          }
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-8">
          {CHANNELS.map((c, i) => (
            <motion.button
              key={c.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: i * 0.05 }}
              whileHover={{ scale: 1.06, y: -6 }}
              whileTap={{ scale: 0.98 }}
              className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-surface p-4 text-right transition-all duration-400 hover:border-brand/45 hover:shadow-[0_22px_60px_-22px_rgba(168,85,247,0.8)]"
            >
              <span
                className="absolute inset-0 opacity-25 transition-opacity duration-500 group-hover:opacity-60"
                style={{ background: `linear-gradient(135deg, ${c.from}, ${c.to})` }}
              />
              <span className="absolute -bottom-10 -left-10 size-28 rounded-full bg-white/10 blur-2xl transition-all duration-500 group-hover:bg-white/20" />
              <span className="relative flex h-[104px] flex-col justify-between">
                <span
                  className="grid size-11 place-items-center rounded-xl text-[15px] font-black text-white shadow-lg ring-1 ring-white/25"
                  style={{ background: `linear-gradient(135deg, ${c.to}, ${c.from})` }}
                >
                  {c.mark}
                </span>
                <span className="block">
                  <span className="block font-display text-[15px] font-bold text-white">
                    {c.name}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-white/55">{c.tag}</span>
                </span>
              </span>
            </motion.button>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
