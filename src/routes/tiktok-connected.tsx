import { createFileRoute } from '@tanstack/react-router';

// Friendly OAuth landing for the TikTok Content Posting connection. Plain,
// factual copy only (honesty rails): "connected" / "not connected", no claims.
export const Route = createFileRoute('/tiktok-connected')({
  head: () => ({
    meta: [
      { title: "TikTok connection — Before You Send" },
      { name: "description", content: "TikTok connection status for Before You Send." },
    ],
  }),
  component: TikTokConnectedPage,
});

function TikTokConnectedPage() {
  const ok = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('ok') === '1' : false;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-cream px-6 py-10 text-ink">
      <div className="card w-full max-w-[420px] p-8 text-center">
        <div className="text-4xl" aria-hidden="true">{ok ? '✓' : '—'}</div>
        <h1 className="mt-3 font-display text-xl font-semibold text-ink">
          {ok ? 'TikTok connected' : 'TikTok not connected'}
        </h1>
        <p className="mt-2 text-base leading-relaxed text-stone">
          {ok
            ? 'This browser is linked to the Before You Send TikTok account. You can close this tab.'
            : 'The connection didn\u2019t complete. Close this tab and try the authorize link again.'}
        </p>
        <a
          href="/"
          className="btn-primary mt-5 w-full"
          style={{
          }}
        >
          Continue to Before You Send →
        </a>
      </div>
    </main>
  );
}
