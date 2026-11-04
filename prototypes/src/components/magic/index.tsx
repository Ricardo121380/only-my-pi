import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/** Magic UI · Border Beam: a light travelling along the border of a running item. */
export function BorderBeam({
  size = 60,
  duration = 6,
  colorFrom = "var(--primary)",
  colorTo = "transparent",
  className,
}: { size?: number; duration?: number; colorFrom?: string; colorTo?: string; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 rounded-[inherit] border border-transparent",
        "[mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)]",
        className,
      )}
    >
      <div
        className="absolute aspect-square bg-gradient-to-l"
        style={
          {
            width: size,
            offsetPath: `rect(0 auto auto 0 round ${size}px)`,
            animation: `border-beam ${duration}s linear infinite`,
            backgroundImage: `linear-gradient(to left, ${colorFrom}, ${colorTo})`,
          } as CSSProperties
        }
      />
    </div>
  );
}

/** Magic UI · Animated Shiny Text: a sweep across "thinking" or "running" labels. */
export function ShinyText({ children, className, width = 80 }: { children: ReactNode; className?: string; width?: number }) {
  return (
    <span
      style={{ "--shiny-width": `${width}px` } as CSSProperties}
      className={cn(
        "bg-clip-text [background-position:0_0] [background-size:var(--shiny-width)_100%] bg-no-repeat",
        "[animation:shiny-text_2.4s_infinite] motion-reduce:animate-none",
        "bg-gradient-to-r from-transparent via-foreground/80 via-50% to-transparent",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Magic UI · Number Ticker: counts budget figures up when they enter view. */
export function NumberTicker({ value, decimals = 0, className, prefix = "" }: { value: number; decimals?: number; className?: string; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const format = (n: number) => prefix + n.toLocaleString("zh-CN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  useEffect(() => {
    if (!inView || !ref.current) return;
    if (reduce) { ref.current.textContent = format(value); return; }
    const controls = animate(0, value, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (n) => { if (ref.current) ref.current.textContent = format(n); },
    });
    return () => controls.stop();
  }, [inView, value]);
  return <span ref={ref} className={cn("tabular-nums", className)}>{format(0)}</span>;
}

/** Aceternity UI · Text Generate Effect: words resolve in as the reply streams. */
export function TextGenerate({ text, className, delay = 0.025 }: { text: string; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  const words = text.split(/(\s+)/);
  return (
    <span className={className}>
      {words.map((word, i) =>
        reduce ? word : (
          <motion.span
            key={i}
            initial={{ opacity: 0, filter: "blur(6px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            transition={{ delay: i * delay, duration: 0.35 }}
          >
            {word}
          </motion.span>
        ),
      )}
    </span>
  );
}

/** Streams a string character by character, used for the live assistant line. */
export function useTypewriter(text: string, active: boolean, cps = 38) {
  const [shown, setShown] = useState(active ? "" : text);
  useEffect(() => {
    if (!active) { setShown(text); return; }
    setShown("");
    let i = 0;
    const id = setInterval(() => {
      i += 2;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, 1000 / cps);
    return () => clearInterval(id);
  }, [text, active, cps]);
  return shown;
}
