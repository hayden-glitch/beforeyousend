// Respect prefers-reduced-motion for JS-driven smooth scrolling.
// CSS animations/transitions are gated globally in app.css; this covers
// scrollIntoView({ behavior }) calls that CSS cannot reach.
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
export function scrollBehavior(
  preferred: ScrollBehavior = "smooth"
): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : preferred;
}
