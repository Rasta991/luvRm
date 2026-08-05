import { AnimatePresence, motion } from "framer-motion";
import { Copy, Check, Globe, Loader2, Lock, Sparkles, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type Title } from "../data/catalog";
import { buildRoomInviteUrl } from "../lib/inviteUrl";
import { getTrending, tmdbToTitle } from "../lib/tmdb";
import { useRouter } from "../lib/router";
import { cn } from "../utils/cn";
import { Button } from "./ui/Primitives";

export function CreateRoomModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { navigate } = useRouter();
  const [name, setName] = useState("ليلة الأفلام 🎬");
  const [privacy, setPrivacy] = useState<"private" | "public">("private");
  const [pick, setPick] = useState<string | null>(null);
  const [picks, setPicks] = useState<Title[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const code = useMemo(
    () => "RV-" + Math.random().toString(36).slice(2, 6).toUpperCase(),
    [open],
  );

  // Load a small slice of trending titles when the modal opens so the user
  // has something to pick from. We refresh on every open so the suggestions
  // stay in sync with what's hot right now.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getTrending("all")
      .then((items) => {
        if (cancelled) return;
        const titles = items
          .filter((it) => !!it.poster_path)
          .slice(0, 10)
          .map((it) => tmdbToTitle(it, it.media_type === "tv" ? "tv" : "movie"));
        setPicks(titles);
        setPick(titles[0]?.id ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setPicks([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

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
              className="glass relative w-full max-w-lg overflow-hidden rounded-3xl p-6 shadow-2xl glow-brand"
            >
              <div className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-brand/25 blur-3xl" />
              <div className="relative">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[10px] font-bold tracking-widest text-[#DDBBFF]">
                      <Sparkles className="size-3" /> WATCH PARTY
                    </div>
                    <h3 className="font-display text-2xl font-extrabold text-white">
                      إنشاء غرفة مشاهدة
                    </h3>
                    <p className="mt-1 text-[13px] text-white/45">
                      شاهدوا معًا بتزامن تام ودردشة حية.
                    </p>
                  </div>
                  <button
                    onClick={onClose}
                    className="grid size-9 place-items-center rounded-full text-white/60 transition hover:bg-white/5 hover:text-white"
                  >
                    <X className="size-5" />
                  </button>
                </div>

                <div className="mt-6 space-y-5">
                  <div>
                    <label className="mb-2 block text-[12px] font-semibold text-white/60">
                      اسم الغرفة
                    </label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-brand/60 focus:bg-brand/[0.06]"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-[12px] font-semibold text-white/60">
                      الخصوصية
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { k: "private", t: "خاصة", d: "بالدعوة فقط", I: Lock },
                        { k: "public", t: "عامة", d: "أي شخص بالكود", I: Globe },
                      ].map((o) => (
                        <button
                          key={o.k}
                          onClick={() => setPrivacy(o.k as "private" | "public")}
                          className={cn(
                            "flex items-center gap-3 rounded-2xl border p-3 text-right transition",
                            privacy === o.k
                              ? "border-brand/60 bg-brand/12 shadow-[0_0_30px_-12px_rgba(168,85,247,0.9)]"
                              : "border-white/10 bg-white/[0.03] hover:border-white/25",
                          )}
                        >
                          <o.I className="size-4 text-brand" />
                          <span>
                            <span className="block text-[13px] font-bold text-white">{o.t}</span>
                            <span className="block text-[11px] text-white/40">{o.d}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-[12px] font-semibold text-white/60">
                      اختر المحتوى
                    </label>
                    <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                      {loading && picks.length === 0 ? (
                        <div className="flex h-24 items-center gap-2 px-2 text-[12px] text-white/45">
                          <Loader2 className="size-4 animate-spin text-brand" />
                          جاري تحميل الاقتراحات…
                        </div>
                      ) : (
                        picks.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => setPick(t.id)}
                            className={cn(
                              "relative h-24 w-16 shrink-0 overflow-hidden rounded-xl border-2 transition",
                              pick === t.id
                                ? "border-brand shadow-[0_0_24px_-6px_rgba(168,85,247,0.9)]"
                                : "border-transparent opacity-60 hover:opacity-100",
                            )}
                          >
                            <img src={t.poster} alt={t.name} loading="lazy" className="size-full object-cover" />
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <div>
                      <p className="text-[11px] text-white/45">كود الغرفة</p>
                      <p className="font-display text-lg font-black tracking-[0.25em] text-white">
                        {code}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        const chosen = picks.find((p) => p.id === pick);
                        navigator.clipboard?.writeText(
                          buildRoomInviteUrl(code, {
                            mediaType: chosen?.mediaType,
                            tmdbId: chosen?.tmdbId,
                            titleId: chosen?.id,
                          }),
                        );
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1800);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-2 text-[12px] text-white/75 transition hover:border-brand/60 hover:bg-brand/15 hover:text-white"
                    >
                      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {copied ? "تم النسخ" : "نسخ الرابط"}
                    </button>
                  </div>

                  <div className="flex gap-3 pt-1">
                    <Button
                      className="flex-1"
                      size="lg"
                      onClick={() => {
                        const chosen = picks.find((p) => p.id === pick);
                        onClose();
                        navigate({
                          name: "room",
                          id: code,
                          ...(chosen?.tmdbId
                            ? {
                                mediaType: chosen.mediaType,
                                tmdbId: chosen.tmdbId,
                                titleId: chosen.id,
                              }
                            : {}),
                        });
                      }}
                    >
                      <Users className="size-[18px]" /> ابدأ الغرفة
                    </Button>
                    <Button variant="outline" size="lg" onClick={onClose}>
                      إلغاء
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
