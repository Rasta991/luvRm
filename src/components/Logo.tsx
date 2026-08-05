import { cn } from "../utils/cn";

export function Logo({ className, onClick }: { className?: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn("group flex items-center gap-2.5 outline-none", className)}
      aria-label="luvinRm"
    >
      <span className="relative grid size-9 place-items-center rounded-xl bg-gradient-to-br from-[#A855F7] to-[#5B21B6] shadow-[0_8px_28px_-8px_rgba(168,85,247,0.9)]">
        <svg viewBox="0 0 24 24" className="size-5 text-white" fill="none">
          <path
            d="M8 5.5v13l10-6.5-10-6.5Z"
            fill="currentColor"
            className="drop-shadow-[0_0_6px_rgba(255,255,255,0.6)]"
          />
        </svg>
        <span className="absolute inset-0 rounded-xl ring-1 ring-white/25" />
      </span>
      <span className="font-display text-[17px] font-black tracking-[0.18em] text-white">
        luvin
        <span className="bg-gradient-to-l from-[#A855F7] to-[#E879F9] bg-clip-text text-transparent">
          Rm
        </span>
      </span>
    </button>
  );
}
