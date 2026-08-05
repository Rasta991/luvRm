import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { CreateRoomModal } from "./components/CreateRoomModal";
import { Navbar } from "./components/Navbar";
import { GlowField } from "./components/ui/Primitives";
import { RouterProvider, useRouter } from "./lib/router";
import { Home } from "./pages/Home";
import { RoomPage } from "./pages/RoomPage";
import { TitlePage } from "./pages/TitlePage";

function Splash() {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 0.6, ease: "easeInOut" }}
      className="fixed inset-0 z-[100] grid place-items-center bg-[#08070B]"
    >
      <div className="flex flex-col items-center gap-5">
        <div className="relative grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-[#A855F7] to-[#5B21B6] shadow-[0_0_60px_-10px_rgba(168,85,247,0.9)]">
          <svg viewBox="0 0 24 24" className="size-8 text-white" fill="none">
            <path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor" />
          </svg>
        </div>
        <div className="h-0.5 w-40 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/2 animate-[shimmer_1.2s_infinite_linear] bg-gradient-to-l from-[#A855F7] to-[#E879F9]" />
        </div>
      </div>
    </motion.div>
  );
}

function Shell() {
  const { route } = useRouter();
  const [modal, setModal] = useState(false);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 900);
    return () => clearTimeout(t);
  }, []);

  return (
    <div dir="rtl" className="relative min-h-screen bg-ink text-white">
      <AnimatePresence>{booting && <Splash />}</AnimatePresence>
      <GlowField />
      <Navbar onCreateRoom={() => setModal(true)} />
      <main className="relative z-10">
        <AnimatePresence mode="wait">
          {route.name === "home" && <Home key="home" onCreateRoom={() => setModal(true)} />}
          {route.name === "title" && (
            <TitlePage
              key={`t-${route.id}`}
              id={route.id}
              mediaType={route.mediaType}
              tmdbId={route.tmdbId}
            />
          )}
          {route.name === "room" && (
            <RoomPage
              key={`r-${route.id}`}
              code={route.id}
              titleId={route.titleId}
              mediaType={route.mediaType}
              tmdbId={route.tmdbId}
            />
          )}
        </AnimatePresence>
      </main>
      <CreateRoomModal open={modal} onClose={() => setModal(false)} />
    </div>
  );
}

export default function App() {
  return (
    <RouterProvider>
      <Shell />
    </RouterProvider>
  );
}
