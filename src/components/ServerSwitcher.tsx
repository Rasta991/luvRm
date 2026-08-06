import { AnimatePresence, motion } from "framer-motion";
import { Loader2, RotateCw, Server } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { EmbedServer } from "../lib/stream";
import { cn } from "../utils/cn";

/**
 * Server status for the switcher's pill row.
 *  - "idle"   : never tried
 *  - "loading": trial in progress (iframe loading, hls.js attaching)
 *  - "ok"     : loaded successfully
 *  - "failed" : explicit error or timeout
 */
export type ServerStatus = "idle" | "loading" | "ok" | "failed";

export interface ServerSwitcherProps {
  servers: EmbedServer[];
  /** Index of the server currently being rendered. */
  activeIndex: number;
  /** Whether the current user can switch servers (host only). */
  canControl: boolean;
  /** Called when the user picks a different server. */
  onSelect: (index: number) => void;
  /**
   * Controlled status map. The parent owns this state so the
   * switcher can react to `VideoPlayer` load events. The map is
   * keyed by server index.
   */
  serverStatuses: Record<number, ServerStatus>;
  /** Optional: when status changes via internal switcher logic. */
  onStatusChange?: (index: number, status: ServerStatus) => void;
  className?: string;
}

const STATUS_DOT: Record<ServerStatus, string> = {
  idle: "bg-white/25",
  loading: "bg-amber-300",
  ok: "bg-emerald-400",
  failed: "bg-rose-400",
};

const STATUS_TEXT: Record<ServerStatus, string> = {
  idle: "—",
  loading: "…",
  ok: "OK",
  failed: "×",
};

/**
 * 6-server switcher (Server 1 → Server 6). Each pill is a button so
 * the row stays finger-friendly on mobile. The switcher is purely
 * UI — the actual playback engine is `VideoPlayer`. The parent
 * passes `serverStatuses` (driven by the player's iframe load/error
 * events) so the switcher can color the dots and auto-advance when
 * the active server fails.
 *
 * Auto-fallback: when the active server's status becomes `failed`,
 * the switcher picks the next non-failed server and calls
 * `onSelect`. Toggleable via the "Auto fallback" checkbox — useful
 * when the user wants to retry a specific server.
 */
export function ServerSwitcher({
  servers,
  activeIndex,
  canControl,
  onSelect,
  serverStatuses,
  onStatusChange,
  className,
}: ServerSwitcherProps) {
  const [autoFallback, setAutoFallback] = useState(true);
  const lastAutoPickedRef = useRef<number | null>(null);

  // Reset the auto-pick tracker when the catalog changes (new title).
  useEffect(() => {
    lastAutoPickedRef.current = null;
  }, [servers.map((s) => s.url).join("|")]);

  // Auto-fallback when the active server reports failed.
  useEffect(() => {
    if (!autoFallback) return;
    if (serverStatuses[activeIndex] !== "failed") return;
    if (lastAutoPickedRef.current === activeIndex) return;
    const next = servers.findIndex(
      (_s, i) => i !== activeIndex && serverStatuses[i] !== "failed",
    );
    if (next < 0) return;
    lastAutoPickedRef.current = next;
    onSelect(next);
  }, [serverStatuses, activeIndex, servers, autoFallback, onSelect]);

  // Pill click handler. Hosts can switch; non-hosts see read-only pills.
  const handleClick = (index: number) => {
    if (!canControl) return;
    if (index === activeIndex) return;
    lastAutoPickedRef.current = index;
    setAutoFallback(true);
    onStatusChange?.(index, "loading");
    onSelect(index);
  };

  if (servers.length === 0) return null;

  const activeIsLoading = serverStatuses[activeIndex] === "loading";

  return (
    <div
      className={cn(
        "relative flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.07] bg-surface/60 px-3 py-2.5 backdrop-blur",
        className,
      )}
      dir="ltr"
      role="tablist"
      aria-label="Server switcher"
    >
      <div className="flex items-center gap-2 pe-2">
        <Server className="size-4 text-brand" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-white/55">
          Servers
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {servers.map((s, i) => {
          const status = serverStatuses[i] ?? "idle";
          const isActive = i === activeIndex;
          const isFailed = status === "failed";
          const isLoading = status === "loading" && isActive;
          return (
            <button
              key={`${s.key}-${s.url}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={`${s.label} (${status})`}
              disabled={!canControl}
              onClick={() => handleClick(i)}
              className={cn(
                "group relative inline-flex items-center gap-2 overflow-hidden rounded-full border px-3 py-1.5 text-[11.5px] font-bold transition",
                isActive
                  ? "border-brand/70 bg-brand/15 text-white shadow-[0_0_18px_-4px_rgba(168,85,247,0.7)]"
                  : "border-white/10 bg-white/[0.04] text-white/70 hover:border-white/30 hover:text-white",
                !canControl && "cursor-default",
                isFailed && !isActive && "border-rose-400/30 bg-rose-500/[0.06]",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full transition",
                  STATUS_DOT[status],
                  isLoading && "animate-pulse",
                )}
                aria-hidden
              />
              <span className="font-display">{i + 1}</span>
              <span className="hidden text-[11px] text-white/55 sm:inline">
                {s.provider}
              </span>
              <span
                className={cn(
                  "ml-0.5 hidden text-[10px] text-white/45 sm:inline",
                  isFailed && "text-rose-200/80",
                )}
              >
                {STATUS_TEXT[status]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="ms-auto flex items-center gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 text-[10.5px] text-white/55">
          <input
            type="checkbox"
            checked={autoFallback}
            onChange={(e) => setAutoFallback(e.target.checked)}
            className="size-3 accent-[#A855F7]"
          />
          Auto fallback
        </label>
        <button
          type="button"
          disabled={!canControl}
          onClick={() => {
            if (!canControl) return;
            lastAutoPickedRef.current = null;
            setAutoFallback(true);
            onSelect(0);
          }}
          className="grid size-7 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition hover:border-brand/40 hover:text-white disabled:opacity-40"
          title="Restart from Server 1"
        >
          <RotateCw className="size-3.5" />
        </button>
      </div>

      {/* Active-server live indicator (small chip) */}
      <AnimatePresence>
        {activeIsLoading && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute -top-2 right-3 hidden items-center gap-1 rounded-full bg-amber-300/90 px-2 py-0.5 text-[9px] font-bold text-black sm:flex"
          >
            <Loader2 className="size-2.5 animate-spin" />
            Loading
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ServerSwitcher;