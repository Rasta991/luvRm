import { Camera, Globe, MessageCircle, Send } from "lucide-react";
import { Logo } from "./Logo";

const COLS = [
  { t: "تصفّح", l: ["أفلام", "مسلسلات", "أنمي", "كرتون", "الأكثر رواجًا"] },
  { t: "الحساب", l: ["ملفي الشخصي", "الاشتراك", "الأجهزة", "التنزيلات"] },
  { t: "الدعم", l: ["مركز المساعدة", "تواصل معنا", "حالة الخدمة", "الأسئلة الشائعة"] },
  { t: "قانوني", l: ["الشروط", "الخصوصية", "ملفات الارتباط", "حقوق النشر"] },
];

export function Footer() {
  return (
    <footer className="relative mt-10 border-t border-white/[0.07] bg-[#0A0910]/80">
      <div className="mx-auto max-w-[1800px] px-4 py-14 sm:px-8 lg:px-14">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-white/45">
              منصة بث عربية فاخرة — شاهد بجودة 4K HDR، وأنشئ غرف مشاهدة مع أصدقائك أينما كانوا.
            </p>
            <div className="mt-5 flex gap-2">
              {[Send, Camera, MessageCircle, Globe].map((I, i) => (
                <a
                  key={i}
                  href="#"
                  className="grid size-9 place-items-center rounded-full border border-white/10 text-white/60 transition hover:border-brand/50 hover:bg-brand/15 hover:text-white"
                >
                  <I className="size-4" />
                </a>
              ))}
            </div>
          </div>
          {COLS.map((c) => (
            <div key={c.t}>
              <h4 className="mb-3 text-[13px] font-bold tracking-wide text-white">{c.t}</h4>
              <ul className="space-y-2">
                {c.l.map((x) => (
                  <li key={x}>
                    <a href="#" className="text-[13px] text-white/45 transition hover:text-brand">
                      {x}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/[0.07] pt-6 text-[12px] text-white/35 sm:flex-row">
          <span>© 2026 luvinRm. جميع الحقوق محفوظة.</span>
          <span>صُنع بشغف للسينما ✦ الرياض · دبي · القاهرة</span>
        </div>
      </div>
    </footer>
  );
}
