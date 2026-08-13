import { useCallback, useEffect, useRef } from "react";
import { track } from "./analytics";

// Typing telemetry for the owner dashboard's live visitor panel.
//
// Fires review_typing_started exactly once per mount (first focus or keystroke),
// then review_typing_active as a THROTTLED heartbeat — at most one per 15s, and
// only while the user actually typed within the last 15s (a focused-but-idle
// visitor does not spam the dashboard). The interval is cleared on blur/unmount,
// so a textarea that was never focused emits nothing. sendBeacon (inside track())
// means events still flush when the page is being closed.
const HEARTBEAT_MS = 15000;

export function useReviewTyping() {
  const startedRef = useRef(false);
  const lastBeatRef = useRef(0);
  const lastActivityRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const heartbeat = useCallback(() => {
    const now = Date.now();
    if (now - lastBeatRef.current >= HEARTBEAT_MS && now - lastActivityRef.current < HEARTBEAT_MS) {
      lastBeatRef.current = now;
      track("review_typing_active");
    }
  }, []);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (!startedRef.current) {
      startedRef.current = true;
      lastBeatRef.current = lastActivityRef.current;
      track("review_typing_started");
    }
    if (timerRef.current === null) {
      // Start (or, after a blur on the same mount, restart) the heartbeat.
      // review_typing_started stays one-per-mount.
      timerRef.current = window.setInterval(heartbeat, HEARTBEAT_MS);
    }
  }, [heartbeat]);

  useEffect(() => clear, [clear]);

  return { onActivity, clear };
}
