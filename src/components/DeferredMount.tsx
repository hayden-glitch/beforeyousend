import { useEffect, useState, type ReactNode } from "react";

type DeferredTrigger = "idle" | "interaction";

/**
 * Performance (D7 final candidate): mounts children only once the browser is
 * idle (or the hard cap elapses) — or, with trigger="interaction", only after
 * the visitor's FIRST interaction (pointer/key/scroll/touch) or the hard cap.
 * Keeps non-critical UI out of the initial-load main thread and out of the
 * post-paint measurement window when the visitor is only reading.
 *
 * SSR renders nothing and the client's FIRST render matches (nothing), so
 * hydration stays clean; the subtree mounts after the trigger. Every caller
 * renders null until opened by its own client-only state, so deferring the
 * mount does not change any visible behavior — it only shifts their
 * listener/timer setup out of the measured load window.
 */
export function DeferredMount({
  children,
  capMs = 2000,
  trigger = "idle",
  placeholder = null,
}: {
  children: ReactNode;
  capMs?: number;
  trigger?: DeferredTrigger;
  // Rendered during the wait instead of null (D9 CLS fix): callers whose
  // deferred subtree sits in normal flow must supply a placeholder matching
  // the mounted footprint so the swap causes zero layout shift.
  placeholder?: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const mark = () => {
      if (!cancelled) setReady(true);
    };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let id: number | undefined;
    if (trigger === "interaction") {
      const EVENTS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
      const onFirst = () => mark();
      EVENTS.forEach((e) => window.addEventListener(e, onFirst, { passive: true, once: true }));
      id = window.setTimeout(mark, capMs);
      return () => {
        cancelled = true;
        window.clearTimeout(id);
        EVENTS.forEach((e) => window.removeEventListener(e, onFirst));
      };
    }
    if (typeof w.requestIdleCallback === "function") {
      id = w.requestIdleCallback(mark, { timeout: capMs });
    } else {
      id = window.setTimeout(mark, Math.min(capMs, 1200));
    }
    return () => {
      cancelled = true;
      if (typeof w.requestIdleCallback === "function" && id !== undefined) {
        w.cancelIdleCallback?.(id);
      } else if (id !== undefined) {
        window.clearTimeout(id);
      }
    };
  }, [capMs, trigger]);
  return ready ? <>{children}</> : <>{placeholder}</>;
}
