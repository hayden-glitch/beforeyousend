import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Scroll-reveal wrapper (interactive design layer — Phase 1).
 *
 * Adds calm motion once when the child scrolls into view (IntersectionObserver,
 * threshold 0.25), then settles and never re-triggers.
 *
 * CONTENT IS VISIBLE BY DEFAULT: the base state renders children fully — the
 * reveal only ADDS motion (rise / settle / brighten via the `.bys-reveal-in`
 * class, see app.css), it never hides them. No-JS and pre-animation states
 * show the complete content; `prefers-reduced-motion` renders the settled
 * state with zero motion (the component settles immediately, and the CSS
 * guard in app.css zeroes the animation/transition durations as well).
 *
 * No analytics, no events, no dependencies.
 */
export default function Reveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (very old browsers): settle immediately —
    // the content is already fully visible, just without the motion.
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    // Reduced motion: settle immediately so no observer is even needed.
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            io.disconnect(); // play once, then settle
            break;
          }
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`bys-reveal${inView ? " bys-reveal-in" : ""}${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}
