/**
 * Calm router-level error fallback (P1, 2026-08-16).
 *
 * Shown when a page fails AFTER the one-time auto-reload was already
 * attempted (see src/lib/reloadGuard.ts) — e.g. a chunk the current build
 * doesn't serve, or an offline reload. Deliberately self-contained: no
 * header/footer chrome, so it renders even when a shared chrome chunk is
 * exactly what failed. On-brand dark surface, no jargon, one way out.
 */
export function RouteErrorFallback() {
  return (
    <div className="min-h-dvh bg-cream">
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col items-start justify-center px-5 sm:px-6"
      >
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">
          Before You Send
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold leading-tight tracking-tight text-forest sm:text-4xl">
          Something changed while you were here — give it one more try.
        </h1>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-primary w-full text-center sm:w-auto"
          >
            Reload
          </button>
        </div>
      </main>
    </div>
  );
}
