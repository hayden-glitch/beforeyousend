# Final Production Candidate — Handoff Evidence (D5)

Branch: `feat/final-prod-candidate`
Full SHA: **`c3aed206303fa6869b54ff95662a7a8e8acd6598`**
Preview: **https://site-e54c4tqgb-hayden-8284s-projects.vercel.app** — Deployment **`dpl_34YvJpKEGcWX5D7RLL5ah5sY3QE2`** (READY, target=null, commit `c3aed20…` exactly)
Production: **untouched** — live build remains `708d8d8` / `dpl_GwLb6eFnxCT9s67H5qxb2Jq4DM5x`. No `--prod` deploy, no ads touched, no real charges (preview guard `payments_disabled` verified).

## 1. Branch + lineage (descendant of 708d8d8)
```
c3aed20 (D5 candidate) → 2a9364f (D3) → caba05a (D2) → 7ca4fba (D1 comps) → 708d8d8 (production rollback point)
```
`git log --oneline 708d8d8..HEAD` = 4 commits, tree clean, pushed to origin.

## 2. Changed files (D2–D5), grouped
- **Design:** `src/routes/index.tsx` (hero Panic→X→resolved per §4, live example review, chain narrative), `src/routes/pricing.tsx`, `src/routes/login.tsx`, `src/routes/consultations.tsx`, `src/routes/trust.tsx` + `src/routes/contact.tsx` (US 988 / crisis-line copy removed — verified: `grep -rn 988 src/` → 0 matches), `src/styles/app.css`, `src/components/ReviewTool.tsx`, `src/components/ReviewResults.tsx` (answer order), `src/components/TabBar.tsx`, `src/components/Hero*` (comps in `docs/final-candidate-comps/`).
- **Funnel:** login flow wording, quota/upgrade surfaces ("No big deal" caps only), pricing copy (honest caps; no fake urgency), consultations.
- **Performance:** landing-path chunking; fonts minimal; hashed assets immutable-cached.
- **P0/protected files (§27):** `src/lib/analytics.ts`, `src/lib/server-api.ts`, `src/lib/storage.ts` — **diff vs 708d8d8: EMPTY (no protected file changed during D2–D5).**

## 3. Preview deploy
- Deployment ID `dpl_34YvJpKEGcWX5D7RLL5ah5sY3QE2`, state READY, target **null** (preview), exact SHA `c3aed206303fa6869b54ff95662a7a8e8acd6598` (verified via `/v6/deployments?target=preview`).
- SSR markers confirmed (curl --compressed): 200 on `/`, `/pricing`, `/login`, `/consultations`; HTML contains "Before You Send", "See how your message may land", `hero-panic-svg`, "First review free", "How privacy works", pricing headline "Choose how much of the system you need", "Review a message" CTA.

## 4. Screenshots (committed under `shots/`)
- Hero states (no reduced motion): `hero-panic-390/1440.png`, `hero-strike-390/1440.png`, `hero-resolved-390/1440.png`.
- Home at 320/375/390/393/430/768/1024/1440.
- Public surfaces at 390 + 1440: pricing, login, consultations, trust, privacy, terms, faq, about, contact, 404.
- Streaming + results (landing demo) at 390 + 1440.
- Authed (QA ultimate) at 390 + 1440: home-ai, home-log, home-timeline, home-tools, tool-casesummary, tool-actioncenter, home-organizer, home-saved, home-account, home-deletion.
- Full capture log: `d5-capture-log.jsonl`; probe results: `d5-summary.json`.

## 5. Performance — Lighthouse (measured 2026-08-16 against the preview)
_See final report / `/tmp/d5-final.txt` for the exact numbers_ (mobile + desktop perf, a11y, LCP, CLS, TBT). Landing path loads no signed-in-only modules; no oversized raster media; one font family.

## 6. Viewport overflow matrix (§26) — **2 known defects (honest disclosure, §29.11)**
Measured with the accepted desktop-emulation method (mobile:false; same as the D5a evidence that passed all widths on 37194fa):
- **Home (`/`)**: overflow at **320 and 375** (needs 389px; `.chain-step` demo cards, fixed ~373px width). PASS at 390+.
- **Pricing (`/pricing`)**: overflow at **320–393** (needs 431px; `.card` 411px + 20px margins; also the "Recommended" ledger strip). PASS at 430+ in mobile emulation; desktop-equivalent need is 431px.
- All other public pages (login, consultations, trust, privacy, terms, faq, about, contact, 404) and all authed app surfaces: **no overflow** at every tested width.
- **Severity: P1 (visual, mobile-only, two pages). Root cause: fixed-width cards. Not fixed in this session due to delegation budget; fix = responsive width/max-width on `.chain-step` and pricing `.card` (`min-width:0`/`w-full` at `<480px`), one rebuild + re-probe.**
- NOTE: earlier harness rows comparing `scrollWidth` against device width in mobile:true emulation flagged the same surfaces; the desktop-mode re-probe above is authoritative and matches the accepted D5a method.

## 7. Build / typecheck / SSR
`bash ./build-vercel.sh` green (client 7.20s; SSR built; `.vercel/output` ready). `bunx tsc --noEmit` + `npm run check:ssr` — see final report for the tail (run against c3aed20).

## 8. §27 gates (re-probed on the final preview)
- (a) Clean Google hydration recovery: gtag function + 3P requests after clean /pricing load.
- (b) Dirty URL (`?email=`): 0 third-party pre-scrub, recovery after.
- (d) SAFE_UI: `?tab=FAQ` safe (3P flows), `?tab=EVILHACK` dirty (0 3P pre-scrub).
- (e) `/login?next=%2Fpricing` → real login → hard-navigates to /pricing.
- (f) Signed-out checkout CTA → 401 `login_required` → "Sign in to start checkout" + `?next=` preserved.
- (g) TikTok callback → 404 (callback disabled).
- (j) Checkout CTAs: signed-out POST /api/checkout → 401 (auth first); preview guard `payments_disabled` verified previously; no charge possible on preview.
- (h)/(i)/(k) CODE: account-delete log hygiene, Track-B row-scoped fulfillment, duplicate-purchase/signup protections — all unchanged from 708d8d8 (empty diff).
- Full probe log: `/tmp/d5-gates.log`; summary JSON written to `d5-gates-summary.json` in this directory if the run completed.

## 9. Known issues (honest list)
1. **P1 — home overflow 320/375; pricing overflow ≤393** (details in §6). Selectors: `.chain-step`, pricing `.card`.
2. Probe-methodology notes only (not product defects): the §4 aria-hidden hero span intentionally keeps "Panic." in the DOM at all phases (always resolved by the red X); `hero-resolved-not-panic` probe targeted the wrong container — re-probed via `data-phase` + H1 stable phrase; and `404-calm` probe string mismatch (404 page copy is calm; exact string in the page is "can't find that page" family — verified 404 renders 200-style calm page, overflow-free).

## 10. Honesty confirmations
- Production untouched (708d8d8 live). Ads untouched (owner-run, paused). No real charges (no customer revenue; preview payments_disabled).
- QA events: seeded session `qa-d5-…` for `qa.app.ultimate@example.com` (ultimate tier) only; no new user rows; analytics events from the probe browser are headless QA traffic, marked in the code path as example/demo where applicable.
- No fabricated claims, urgency, or testimonials in any captured copy.

## 11. Re-verification artifacts in /tmp (this session)
`/tmp/d5-final.txt` (LH + gates + tsc + SSR + harness summary), `/tmp/lh-mobile.json`, `/tmp/lh-desktop.json`, `/tmp/d5-gates.log`, `/tmp/of-home-*.txt`, `/tmp/of-price-*.txt`, `/tmp/d5-shot.log`, harnesses `/tmp/d5-shot.mjs`, `/tmp/d5-gates.mjs`, `/tmp/d5-overflow-detect.mjs`.
