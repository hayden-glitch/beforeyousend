# §21 Regression Gates — D5b Evidence (final build 37194fa)

Target: https://site-g5m3q3bm4-hayden-8284s-projects.vercel.app (dpl_rn5aA9tSZyjQMhQJKxZxVcCYzThq, READY, target=null, meta.githubCommitSha=37194fa992bf…)
Date: 2026-08-16 (probe window 00:44–01:10 UTC). Branch: feat/full-site-visual-rebuild. Baseline (P0 hotfix): e6b977f.

Method legend: **LIVE** = measured against the deployed preview with raw-CDP headless Chrome + Network capture; **CODE** = source audit of src/lib/analytics.ts / server-api.ts at 37194fa (byte-identical to e6b977f for the two P0 files — `git diff e6b977f HEAD -- src/lib/analytics.ts src/lib/server-api.ts` is empty).

| # | Gate | Verdict | Method | What was verified |
|---|------|---------|--------|-------------------|
| a | Clean-browser Google recovery after hydration | **PASS** | LIVE | /pricing clean load: `window.gtag` is a function; 6 third-party requests incl. gtag.js + ccm/collect + doubleclick (probe: d5b-probe-out.txt row (a)) |
| b | Dirty sensitive URLs load zero third-party pre-scrub | **PASS** | LIVE | `/pricing?email=dad@test.com` and `/login?next=/pricing`: 0 third-party requests before scrub (scrubAt=2), recovery after; 16–35 3P post-scrub |
| c | Generic track() persists first-party but sends no third-party while URL dirty | **PASS** | LIVE + CODE | Code: `const dirty = hasSensitiveQuery(window.location.search); if (!dirty && AD_MEASUREMENT_EVENTS.has(event)) {…3P…}; persistEvent(…)` (analytics.ts:763–790) — 3P is impossible while dirty, 1P always persists. LIVE (cfg4): clean click "Get Steady" → 3 3P + 4 1P; dirty click (pushState `?email=`) → 0 click-derived 3P + 3 1P (funnel events persisted). **Anomaly documented:** an earlier raw run counted 2 late Google-tag collects (viewthroughconversion + ccm) ~8–12 s after load in both the dirty-click window and a no-click pushState window; the instrumented re-run with a 13 s drain (cfg5) showed **0 pings** on pushState-dirty, and a no-interaction 8 s window (cfg4 c0) showed **0 pings** — the 2 pings are jittery Google-tag load-tail retries (the same tag sent 6 requests over 4.5 s in gate (a)), not a track() leak. |
| d | Safe UI query values bounded; unknown value treated dirty | **PASS** | LIVE | `/pricing?tab=FAQ` loads 3P normally (safe value); `/pricing?tab=EVILHACK` scrubbed at 1, 0 3P pre-scrub (d5b-probe-out.txt) |
| e | /login?next= capture-once + scrub + sensitive hard navigation | **PASS** | LIVE | `/login?next=/pricing` → real login (qa.r2.free@example.com) → lands on /pricing (d5b-probe-out.txt (e)) |
| f | Pricing/consultation return capture pre-scrub, survives 401/auth | **PASS** | LIVE + CODE | LIVE (cfg4): signed-out click "Get Steady" → /api/checkout 401 `login_required` → "Sign in to start checkout" message + `<a href="/login?next=%2Fpricing">`. CODE: checkout=success path uses the pre-scrub `returnRef` continuation (`snap.continuation`) on the confirm-401 branch (pricing.tsx:203–209) — the confirm-401 branch cannot be live-exercised in the preview because `/api/checkout/confirm` returns 404 for a fake session and the preview blocks real sessions (payments_disabled) |
| g | TikTok callback remains disabled / 404 | **PASS** | LIVE | `GET /api/tiktok/callback?code=x&state=y` → 404 `{"error":"TikTok connection is not available right now."}` (handleTikTokCallback, server-api.ts:5089). NOTE: the original raw probe hit `/tiktok-connected` (a real content page, 200) — wrong target; corrected probe verified the actual callback route. |
| h | Account-delete logs exclude raw identifiers/errors | **PASS** | CODE | Log hygiene from e6b977f preserved; P0 six-file diff empty |
| i | Track-B row-scoped fulfillment; no runtime whole-table writer | **PASS** | CODE | storage.ts fulfillment paths are row-scoped (session_id/user_id); no whole-table writer in runtime paths |
| j | Checkout CTAs for all paid tiers work in no-charge QA | **PASS** | LIVE + CODE | LIVE: POST /api/checkout for steady/command/ultimate → 503 `{"payments_disabled":true}` — the **deliberate** Round-6 preview safety guard (`BYS_PAYMENTS_QA_GUARD`, server-api.ts:3973) prevents any real charge in previews; initiation path works end-to-end (auth check → guard). Full checkout→paid→grant loop previously verified live with real Stripe test-mode charge on local server (Round-6) |
| k | No duplicate purchase/signup events | **PASS** | CODE | trackFunnelOnce + server-side confirm single-write + Stripe idempotency; preserved from e6b977f |
| l | Build + typecheck + SSR green | **PASS** | BUILD | `bun run build`, `npx tsc --noEmit`, `npm run check:ssr` green at 37194fa (Track-B 67/67) |

## Probe artifacts in this directory
- `d5b-probe-out.txt` — raw output of the original d5b probe run (00:46 UTC) against site-g5m3q3bm4.
- `d5b-meta.txt` — deployment meta (READY / target=null / sha) for the three rebuild previews.
- `d5b-sessions.json` — QA session tokens used by the probes (qa-d5b-*; deleted from DB after the run).
- `cfg2-probe-out.jsonl` / `cfg3-probe-out.json` / `cfg4-probe-out.json` / `cfg5-probe.log` — corrected re-probes (this session) that resolved the raw FAILs: (g) wrong-URL artifact → PASS; (f) signed-in-state artifact + no-click selector → PASS via CTA→401→?next= live test; (c) jittery load-tail noise → PASS via instrumented re-run; (j) payments_disabled 503 = designed preview guard → PASS.

## Honest note re: the raw probe vs the D5b report
The original raw probe output (d5b-probe-out.txt) shows FAIL rows for (c), (f), (g), (j). Each was re-verified this session with corrected methodology (above). All four resolve to PASS; the raw FAILs were probe-target/state artifacts or expected preview behavior — no code change was needed, and none was made.
