import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, KeyRound, Loader2, LogIn, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "../lib/router";
import { Button } from "./ui/Primitives";

/**
 * "Join by code" modal. Triggered from the Navbar.
 *
 *   1. The user pastes or types a room code (e.g. "RV-8842").
 *   2. We normalise the input — strip whitespace, uppercase, and
 *      auto-prefix `RV-` if the user only typed digits.
 *   3. On submit we route to `#/room/<code>` so the existing RoomPage
 *      picks it up and the existing real-time sync engine latches the
 *      new joiner onto the host's playback state.
 *
 * The modal is fully keyboard-accessible: Esc closes, Enter submits
 * while the input is focused, and the first input is auto-focused
 * when the modal opens.
 */
export function JoinRoomModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { navigate } = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [raw, setRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Auto-focus the input and reset the form on every open.
  useEffect(() => {
    if (!open) return;
    setRaw("");
    setSubmitting(false);
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /**
   * Normalise a raw room code into the canonical `RV-XXXX` shape that
   * `CreateRoomModal` produces. We accept a few common formats so
   * pasting from chat / email "just works":
   *   "rv8842"   → "RV-8842"
   *   "RV-8842"  → "RV-8842"
   *   " 8842 "   → "RV-8842"
   *   "ABC123"   → "RV-ABC123"  (preserve if letters exist)
   */
  const normaliseCode = (value: string): string => {
    const v = value.trim().toUpperCase().replace(/\s+/g, "");
    if (!v) return "";
    const m = v.match(/^(?:RV-?)?([A-Z0-9]{2,12})$/);
    if (!m) return v;
    return `RV-${m[1]}`;
  };

  const code = normaliseCode(raw);
  const isValid = /^RV-[A-Z0-9]{2,12}$/.test(code);

  const submit = () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    onClose();
    // Small delay so the modal exit animation doesn't fight the route
    // transition.
    setTimeout(() => {
      navigate({ name: "room", id: code });
    }, 80);
  };

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
              className="glass relative w-full max-w-md overflow-hidden rounded-3xl p-6 shadow-2xl glow-brand"
            >
              <div className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-brand/25 blur-3xl" />
              <div className="relative">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[10px] font-bold tracking-widest text-[#DDBBFF]">
                      <LogIn className="size-3" /> JOIN ROOM
                    </div>
                    <h3 className="font-display text-2xl font-extrabold text-white">
                      انضمام لغرفة
                    </h3>
                    <p className="mt-1 text-[13px] text-white/45">
                      أدخل كود الغرفة للانضمام إلى جلسة المشاهدة.
                    </p>
                  </div>
                  <button
                    onClick={onClose}
                    className="grid size-9 place-items-center rounded-full text-white/60 transition hover:bg-white/5 hover:text-white"
                    aria-label="إغلاق"
                  >
                    <X className="size-5" />
                  </button>
                </div>

                <form
                  className="mt-6 space-y-5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit();
                  }}
                >
                  <div>
                    <label
                      htmlFor="join-room-code"
                      className="mb-2 block text-[12px] font-semibold text-white/60"
                    >
                      كود الغرفة
                    </label>
                    <div
                      className="group relative flex items-center rounded-2xl border border-white/10 bg-white/[0.04] transition focus-within:border-brand/60 focus-within:bg-brand/[0.06]"
                    >
                      <span className="grid size-11 shrink-0 place-items-center text-white/45">
                        <KeyRound className="size-4" />
                      </span>
                      <input
                        id="join-room-code"
                        ref={inputRef}
                        dir="ltr"
                        value={raw}
                        onChange={(e) => setRaw(e.target.value)}
                        placeholder="RV-8842"
                        autoComplete="off"
                        inputMode="text"
                        spellCheck={false}
                        className="min-w-0 flex-1 bg-transparent py-3 pe-4 text-sm text-white placeholder:text-white/30 focus:outline-none"
                        aria-invalid={raw.length > 0 && !isValid}
                      />
                      {isValid && (
                        <span className="grid size-9 place-items-center text-emerald-300">
                          <Check className="size-4" />
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-white/40">
                      <span>
                        مثال:{" "}
                        <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-white/70">
                          RV-8842
                        </code>
                      </span>
                      {raw.length > 0 && !isValid && (
                        <span className="text-rose-300">
                          صيغة غير صحيحة. أدخل كودًا بحرفين وأرقام، مثل RV-1234.
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Live preview of the normalised code so the user
                      sees what they're about to join. */}
                  <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <div>
                      <p className="text-[11px] text-white/45">ستنتقل إلى</p>
                      <p className="font-display text-lg font-black tracking-[0.25em] text-white">
                        {code || "—"}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/15 px-2.5 py-1 text-[10px] font-bold text-[#DDBBFF]">
                      <ArrowLeft className="size-3" /> غرفة مباشرة
                    </span>
                  </div>

                  <div className="flex gap-3 pt-1">
                    <Button
                      type="submit"
                      className="flex-1"
                      size="lg"
                      disabled={!isValid || submitting}
                    >
                      {submitting ? (
                        <Loader2 className="size-[18px] animate-spin" />
                      ) : (
                        <LogIn className="size-[18px]" />
                      )}
                      دخول
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      onClick={onClose}
                    >
                      إلغاء
                    </Button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
