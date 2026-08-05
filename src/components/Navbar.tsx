import { AnimatePresence, motion, useScroll, useMotionValueEvent } from "framer-motion";
import {
  Bell,
  Bookmark,
  Compass,
  Film,
  Home,
  LogIn,
  Menu,
  Search,
  Sparkles,
  Tv,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Title } from "../data/catalog";
import {
  getNowPlaying,
  getOnTheAir,
  getTrending,
  getUpcoming,
  searchMulti,
  tmdbToTitle,
} from "../lib/tmdb";
import { useRouter } from "../lib/router";
import { cn } from "../utils/cn";
import { JoinRoomModal } from "./JoinRoomModal";
import { Logo } from "./Logo";
import { Button } from "./ui/Primitives";

const LINKS = [
  { label: "الرئيسية", icon: Home },
  { label: "أفلام", icon: Film },
  { label: "مسلسلات", icon: Tv },
  { label: "استكشاف", icon: Compass },
  { label: "قائمتي", icon: Bookmark },
];

interface Notif {
  /** Notification body text. */
  t: string;
  /** Relative time, e.g. "قبل ٥ دقائق". */
  s: string;
  hot?: boolean;
  /** Optional deep-link TMDB id + mediaType so the user can jump straight in. */
  tmdbId?: number;
  mediaType?: "movie" | "tv";
}

// Room-invitation fixtures — kept inline because they aren't something
// we can derive from TMDB. The dynamic release alerts below make up the
// rest of the drawer.
const INVITE_NOTIFS: Notif[] = [
  {
    t: "دعاك كريم للانضمام إلى غرفة «ليلة الرعب»",
    s: "قبل ٢٢ دقيقة",
    hot: true,
  },
];

export function Navbar({ onCreateRoom }: { onCreateRoom: () => void }) {
  const { navigate } = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [notifOpen, setNotifOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [active, setActive] = useState("الرئيسية");
  const [notifs, setNotifs] = useState<Notif[]>(INVITE_NOTIFS);
  const [results, setResults] = useState<Title[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { scrollY } = useScroll();

  // Build release alerts from TMDB: now-playing in theatres + upcoming
  // + on-the-air. We map each result into a notification body and time,
  // and prepend them above the static invitation. Only runs when the
  // notifications drawer is opened for the first time.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getNowPlaying().catch(() => []),
      getUpcoming().catch(() => []),
      getOnTheAir().catch(() => []),
    ]).then(([nowPlaying, upcoming, onAir]) => {
      if (cancelled) return;
      const releaseNotifs: Notif[] = [];
      for (const it of nowPlaying.slice(0, 2)) {
        const t = tmdbToTitle(it, "movie");
        releaseNotifs.push({
          t: `«${t.name}» يصدر الآن في السينما`,
          s: "قبل دقائق",
          hot: true,
          tmdbId: t.tmdbId,
          mediaType: t.mediaType,
        });
      }
      for (const it of upcoming.slice(0, 2)) {
        const t = tmdbToTitle(it, "movie");
        const date = it.release_date || "";
        releaseNotifs.push({
          t: `«${t.name}» سيتاح قريبًا${date ? ` (${date})` : ""}`,
          s: "هذا الأسبوع",
          hot: false,
          tmdbId: t.tmdbId,
          mediaType: t.mediaType,
        });
      }
      for (const it of onAir.slice(0, 1)) {
        const t = tmdbToTitle(it, "tv");
        releaseNotifs.push({
          t: `حلقة جديدة من «${t.name}» متاحة الآن`,
          s: "قبل ساعة",
          hot: false,
          tmdbId: t.tmdbId,
          mediaType: t.mediaType,
        });
      }
      if (releaseNotifs.length) setNotifs([...releaseNotifs, ...INVITE_NOTIFS]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live TMDB-backed search. Debounced so we don't hammer the API on
  // every keystroke. Falls back to a small trending slice when the
  // query is empty.
  useEffect(() => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      let cancelled = false;
      searchMulti(trimmed)
        .then((items) => {
          if (cancelled) return;
          const titles = items
            .filter((it) => it.media_type === "movie" || it.media_type === "tv")
            .slice(0, 6)
            .map((it) => tmdbToTitle(it, it.media_type === "tv" ? "tv" : "movie"));
          setResults(titles);
        })
        .catch(() => {
          if (cancelled) return;
          setResults([]);
        });
      return () => {
        cancelled = true;
      };
    }, 240);
    return () => clearTimeout(handle);
  }, [q]);

  // Trending fallback when search opens but the user hasn't typed.
  useEffect(() => {
    if (!searchOpen || q.trim()) return;
    let cancelled = false;
    getTrending("all")
      .then((items) => {
        if (cancelled) return;
        setResults(
          items
            .filter((it) => it.backdrop_path)
            .slice(0, 6)
            .map((it) => tmdbToTitle(it, it.media_type === "tv" ? "tv" : "movie")),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [searchOpen, q]);

  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 24));

  useEffect(() => {
    if (searchOpen) setTimeout(() => inputRef.current?.focus(), 60);
  }, [searchOpen]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <>
      <motion.header
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-all duration-500",
          scrolled
            ? "border-b border-white/[0.07] bg-[#08070B]/80 backdrop-blur-2xl supports-[backdrop-filter]:bg-[#08070B]/65"
            : "bg-gradient-to-b from-black/70 via-black/25 to-transparent",
        )}
      >
        <div className="mx-auto flex h-[68px] max-w-[1800px] items-center gap-3 px-4 sm:px-8 lg:px-14">
          <button
            className="grid size-10 shrink-0 place-items-center rounded-xl text-white/80 transition hover:bg-white/5 lg:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="القائمة"
          >
            <Menu className="size-5" />
          </button>

          <Logo onClick={() => navigate({ name: "home" })} />

          <nav className="mr-6 hidden items-center gap-1 lg:flex">
            {LINKS.map((l) => (
              <button
                key={l.label}
                onClick={() => {
                  setActive(l.label);
                  navigate({ name: "home" });
                }}
                className={cn(
                  "relative rounded-full px-4 py-2 text-[13.5px] font-medium transition-colors",
                  active === l.label ? "text-white" : "text-white/55 hover:text-white/90",
                )}
              >
                {active === l.label && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-full border border-brand/30 bg-brand/12"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative">{l.label}</span>
              </button>
            ))}
          </nav>

          <div className="flex flex-1 items-center justify-end gap-1.5 sm:gap-2">
            {/* search */}
            <div className="relative">
              <motion.div
                animate={{ width: searchOpen ? 260 : 40 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className={cn(
                  "flex h-10 items-center overflow-hidden rounded-full",
                  searchOpen ? "glass px-3" : "",
                )}
              >
                <button
                  onClick={() => setSearchOpen((s) => !s)}
                  className="grid size-10 shrink-0 place-items-center rounded-full text-white/80 transition hover:bg-white/5 hover:text-white"
                  aria-label="بحث"
                >
                  {searchOpen ? <X className="size-[18px]" /> : <Search className="size-[18px]" />}
                </button>
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="ابحث عن فيلم، مسلسل، نوع…"
                  className="w-full bg-transparent px-1 text-sm text-white placeholder:text-white/35 focus:outline-none"
                />
              </motion.div>

              <AnimatePresence>
                {searchOpen && results.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    className="glass absolute left-0 top-12 w-[320px] overflow-hidden rounded-2xl p-2 shadow-2xl"
                  >
                    {results.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => {
                          navigate({ name: "title", id: r.id });
                          setSearchOpen(false);
                          setQ("");
                        }}
                        className="flex w-full items-center gap-3 rounded-xl p-2 text-right transition hover:bg-white/[0.06]"
                      >
                        <img
                          src={r.poster}
                          alt=""
                          loading="lazy"
                          className="h-14 w-10 rounded-md object-cover"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-white">
                            {r.name}
                          </span>
                          <span className="block truncate text-[11px] text-white/45">
                            {r.original} · {r.year} · {r.quality}
                          </span>
                        </span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* notifications */}
            <div className="relative">
              <button
                onClick={() => setNotifOpen((n) => !n)}
                className="relative grid size-10 place-items-center rounded-full text-white/80 transition hover:bg-white/5 hover:text-white"
                aria-label="الإشعارات"
              >
                <Bell className="size-[18px]" />
                <span className="pulse-dot absolute right-2 top-2 size-2 rounded-full bg-brand" />
              </button>
              <AnimatePresence>
                {notifOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    className="glass absolute left-0 top-12 w-[320px] overflow-hidden rounded-2xl shadow-2xl"
                  >
                    <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                      <span className="text-sm font-bold text-white">الإشعارات</span>
                      <span className="rounded-full bg-brand/20 px-2 py-0.5 text-[10px] font-bold text-[#DDBBFF]">
                        جديد ٢
                      </span>
                    </div>
                    <div className="max-h-[300px] overflow-y-auto thin-scrollbar">
                      {notifs.map((n, i) => (
                        <button
                          key={`${n.t}-${i}`}
                          type="button"
                          disabled={!n.tmdbId}
                          onClick={() => {
                            if (!n.tmdbId || !n.mediaType) return;
                            setNotifOpen(false);
                            navigate({
                              name: "room",
                              id: "RV-8842",
                              mediaType: n.mediaType,
                              tmdbId: n.tmdbId,
                            });
                          }}
                          className={cn(
                            "flex w-full gap-3 border-b border-white/5 px-4 py-3 text-right transition",
                            n.tmdbId ? "hover:bg-white/[0.04]" : "cursor-default",
                          )}
                        >
                          <span
                            className={cn(
                              "mt-1.5 size-2 shrink-0 rounded-full",
                              n.hot ? "bg-brand" : "bg-white/20",
                            )}
                          />
                          <span>
                            <span className="block text-[13px] leading-snug text-white/85">{n.t}</span>
                            <span className="mt-1 block text-[11px] text-white/35">{n.s}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <Button
              size="sm"
              variant="glass"
              onClick={() => setJoinOpen(true)}
              className="hidden md:inline-flex"
              title="انضمام لغرفة عبر الكود"
            >
              <LogIn className="size-4" />
              انضمام لغرفة
            </Button>

            <button
              onClick={() => setJoinOpen(true)}
              className="hidden size-10 place-items-center rounded-full border border-white/12 bg-white/[0.04] text-white/80 transition hover:border-brand/40 hover:text-white md:hidden sm:grid"
              aria-label="انضمام لغرفة"
              title="انضمام لغرفة"
            >
              <LogIn className="size-[18px]" />
            </button>

            <Button
              size="sm"
              onClick={onCreateRoom}
              className="hidden sm:inline-flex"
            >
              <Users className="size-4" />
              إنشاء غرفة
            </Button>

            <button
              onClick={onCreateRoom}
              className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-[#A855F7] to-[#6D28D9] text-white sm:hidden"
              aria-label="إنشاء غرفة"
            >
              <Users className="size-[18px]" />
            </button>

            <button className="ml-0.5 flex items-center gap-2 rounded-full p-0.5 pl-2 transition hover:bg-white/5">
              <img
                src="https://i.pravatar.cc/80?img=12"
                alt="الملف الشخصي"
                className="size-9 rounded-full object-cover ring-2 ring-brand/50"
              />
            </button>
          </div>
        </div>
      </motion.header>

      {/* mobile drawer */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="fixed inset-y-0 left-0 z-[61] w-[290px] border-r border-white/10 bg-[#0C0A12]/95 backdrop-blur-2xl lg:hidden"
            >
              <div className="flex items-center justify-between px-5 py-5">
                <Logo />
                <button
                  onClick={() => setMenuOpen(false)}
                  className="grid size-9 place-items-center rounded-lg text-white/70 hover:bg-white/5"
                >
                  <X className="size-5" />
                </button>
              </div>
              <nav className="space-y-1 px-3">
                {LINKS.map((l, i) => (
                  <motion.button
                    key={l.label}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 + i * 0.05 }}
                    onClick={() => {
                      setActive(l.label);
                      setMenuOpen(false);
                      navigate({ name: "home" });
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-[15px] transition",
                      active === l.label
                        ? "border border-brand/30 bg-brand/12 text-white"
                        : "text-white/60 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <l.icon className="size-[18px]" />
                    {l.label}
                  </motion.button>
                ))}
              </nav>
              <div className="absolute inset-x-4 bottom-6 space-y-3">
                <div className="glass rounded-2xl p-4">
                  <div className="flex items-center gap-2 text-[13px] font-bold text-white">
                    <Sparkles className="size-4 text-brand" />
                    luvinRm Ultra
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-white/45">
                    4K HDR بلا إعلانات + غرف مشاهدة غير محدودة.
                  </p>
                </div>
                <Button
                  className="w-full"
                  onClick={() => {
                    setMenuOpen(false);
                    onCreateRoom();
                  }}
                >
                  <Users className="size-4" /> إنشاء غرفة مشاهدة
                </Button>
                <Button
                  variant="glass"
                  className="w-full"
                  onClick={() => {
                    setMenuOpen(false);
                    setJoinOpen(true);
                  }}
                >
                  <LogIn className="size-4" /> انضمام بكود
                </Button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <JoinRoomModal open={joinOpen} onClose={() => setJoinOpen(false)} />
    </>
  );
}
