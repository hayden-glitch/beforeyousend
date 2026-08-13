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
    <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#f5f2ea' }}>
      <div style={{ maxWidth: 420, width: '100%', background: '#fff', borderRadius: 16, padding: 32, textAlign: 'center', boxShadow: '0 8px 30px rgba(31,44,36,0.08)' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>{ok ? '✓' : '—'}</div>
        <h1 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#1f2c24' }}>
          {ok ? 'TikTok connected' : 'TikTok not connected'}
        </h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: '#4a574e' }}>
          {ok
            ? 'This browser is linked to the Before You Send TikTok account. You can close this tab.'
            : 'The connection didn\u2019t complete. Close this tab and try the authorize link again.'}
        </p>
        <a
          href="/"
          style={{
            display: 'inline-block',
            marginTop: 20,
            padding: '12px 20px',
            borderRadius: 999,
            background: '#1f2c24',
            color: '#faf7f1',
            fontSize: 15,
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Continue to Before You Send →
        </a>
      </div>
    </main>
  );
}
