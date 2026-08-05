import { motion, type HTMLMotionProps } from "framer-motion";
import { Star } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

/* ---------------- Buttons ---------------- */

type BtnProps = HTMLMotionProps<"button"> & {
  variant?: "primary" | "glass" | "ghost" | "outline";
  size?: "sm" | "md" | "lg";
  children?: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: BtnProps) {
  return (
    <motion.button
      whileHover={{ scale: 1.035, y: -1 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 420, damping: 26 }}
      className={cn(
        "relative inline-flex items-center justify-center gap-2 rounded-full font-semibold tracking-tight",
        "transition-colors duration-300 outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
        size === "sm" && "px-4 py-2 text-[13px]",
        size === "md" && "px-5 py-2.5 text-sm",
        size === "lg" && "px-7 py-3.5 text-[15px]",
        variant === "primary" &&
          "bg-gradient-to-l from-[#7C3AED] to-[#A855F7] text-white shadow-[0_10px_35px_-10px_rgba(168,85,247,0.85)] hover:shadow-[0_16px_45px_-10px_rgba(168,85,247,1)]",
        variant === "glass" && "glass text-white/90 hover:text-white hover:border-brand/40",
        variant === "outline" &&
          "border border-white/15 bg-white/[0.03] text-white/85 hover:border-brand/50 hover:bg-brand/10",
        variant === "ghost" && "text-white/70 hover:text-white hover:bg-white/5",
        className,
      )}
      {...props}
    >
      {children}
    </motion.button>
  );
}

/* ---------------- Badges ---------------- */

export function Badge({
  children,
  className,
  tone = "default",
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "brand" | "quality";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-[3px] text-[10px] font-bold uppercase tracking-widest",
        tone === "default" && "border border-white/15 bg-white/5 text-white/70",
        tone === "brand" && "border border-brand/40 bg-brand/15 text-[#DDBBFF]",
        tone === "quality" &&
          "border border-brand/30 bg-gradient-to-l from-brand-2/25 to-brand/25 text-[#E7D3FF]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Rating({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold text-amber-300", className)}>
      <Star className="size-3.5 fill-amber-300 stroke-amber-300" />
      {value.toFixed(1)}
    </span>
  );
}

/* ---------------- Section heading ---------------- */

export function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-xl font-extrabold tracking-tight text-white sm:text-2xl">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-[13px] text-white/45">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---------------- Skeletons ---------------- */

export function PosterSkeleton() {
  return <div className="shimmer aspect-[2/3] w-full rounded-2xl border border-white/5" />;
}

export function RowSkeleton() {
  return (
    <div className="px-4 sm:px-8 lg:px-14">
      <div className="shimmer mb-4 h-6 w-44 rounded-lg" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="w-[42vw] shrink-0 sm:w-[24vw] lg:w-[15vw]">
            <PosterSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Glow orbs background ---------------- */

export function GlowField() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="orb absolute -top-40 right-[-10%] size-[46rem] rounded-full bg-[radial-gradient(circle,rgba(124,58,237,0.22),transparent_62%)] blur-3xl" />
      <div
        className="orb absolute top-1/3 left-[-15%] size-[38rem] rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.16),transparent_62%)] blur-3xl"
        style={{ animationDelay: "-6s" }}
      />
      <div
        className="orb absolute bottom-0 left-1/3 size-[30rem] rounded-full bg-[radial-gradient(circle,rgba(217,70,239,0.10),transparent_62%)] blur-3xl"
        style={{ animationDelay: "-3s" }}
      />
    </div>
  );
}
