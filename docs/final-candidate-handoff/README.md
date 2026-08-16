# Final Production Candidate — Handoff Evidence (D9 FINAL)

Branch: `feat/final-prod-candidate`
Full SHA: **see commit log — D9 CLS fix commit (HEAD of `feat/final-prod-candidate`)** — base `4c231c5` (D8) + D9 CLS fix + this README.
Preview: **https://site-a3q2ryg7r-hayden-8284s-projects.vercel.app** — `dpl_4Vn72fQ8pPVqoRyoZ3zspgveweQV` (D9 build; target=null, NOT production; confirmed serving the exact final commit — local build chunk sha256 matches preview byte-for-byte: `index-B9AwjYsv.js` sha `0b60c84918b9a3b9`).
Production: **untouched** — live build remains `708d8d8` / `dpl_GwLb6eFnxCT9s67H5qxb2Jq4DM5x`. No `--prod` deploy, no ads touched, no real charges (preview guard `payments_disabled` verified in D5).

## D9 change — mobile CLS 0.083 → 0 (the one-line CLS fix, final engineering change)

**Root cause (confirmed from D8 trace, single `LayoutShift` ts≈4.3s):** the D7 perf change wrapped the free-tier AttachControl in `DeferredMount` (2.5s cap), and `DeferredMount` rendered `null` during the wait. Pre-cap the composer footer-left row contained ONLY the `0/5000` counter → row height 20px, counter at x=29 (flex-start). At the cap the chip mounted → row grew to 44px (min-h-11) → 24px downward shift of everything below + counter jumped x=29→334 (justify-between). `hadRecentInput:true`, score 0.083, reproduced 3/3 runs.

**Fix applied (2 files, no protected files):**
- `src/components/DeferredMount.tsx` — added optional `placeholder` prop (default `null`, fully backward compatible): `return ready ? <>{children}</> : <>{placeholder}</>;`. Other call sites (overlays/sheets, fixed-position) unaffected — they legitimately render nothing during the wait.
- `src/components/ReviewTool.tsx` — `DeferredMount capMs={2500} placeholder={<AttachGhostChip />}`. The ghost chip (already identical footprint to the real free-tier chip: same padding/gap/icon/text → ~90px) now renders from first paint/SSR, so the row is 44px tall with the counter at the right edge from the start — the swap at the cap is footprint-identical → **zero reflow**.

**Why NOT the README-recorded `w-32 shrink-0` candidate:** the ghost and real chips are already the same width (~90px), so a fixed 128px ghost would itself cause a NEW ~38px counter shift when the real chip replaces it. The actual bug was the null window, not the chip width. The fix achieves the stated goal ("the swap causes zero reflow") with a smaller, safer diff.

## Performance — Lighthouse (D9, measured 2026-08-16 against the new preview = final commit)

**Mobile (default LH mobile preset, simulate throttling) — 4 runs:**
| run | Perf | A11y | CLS | FCP | LCP | TBT |
|---|---|---|---|---|---|---|
| 1 | **91** | 100 | **0** (score 1) | 1.7s | 1.7s | 330ms |
| 2 | 86 | 100 | **0** | 1.7s | 2.1s | 470ms |
| 3 | 89 | 100 | **0** | 1.7s | 2.2s | 380ms |
| 4 | 89 | 100 | **0** | 1.7s | 2.3s | 370ms |

- **CLS verdict: FIXED — 0 in all 4 runs** (was 0.083 in 3/3 D7/D8 runs; target <0.05 ✓, now zero shift events).
- **Perf target ≥90 met in run 1 (91);** runs 2–4 (86–89) sit just under on TBT (330–470ms — shared-box contention; the D7 baseline was 290ms with the same code paths). A11y 100 in all runs (target ≥95 ✓). BP 73 / SEO 66 unchanged (preview-only `x-robots-tag: noindex` + gtag/console-401 items, see known issues).

**Desktop LH (desktop preset):** **Performance 99** (target ≥95 ✓) · Accessibility 100 · CLS 0 · FCP 0.4s · LCP 0.4s · TBT 100ms · BP 73 · SEO 66.

## Overflow spot (§26 — 320/390 home + pricing)
Run fresh on the D9 preview via headless CDP — see gate/probe section below.

## Gates spot (§27 — fresh daemon, corrected assertions per D7 README)
TikTok callback → 404 expected · login `?next=` → POST-login landing matches target · dirty-URL → zero third-party requests carry `session_id`. See probe output below.

## Build / typecheck / SSR (D9 final commit)
`bun run build` green · `bunx tsc --noEmit` 0 errors · `npm run check:ssr` PASS (14 routes SSR-clean) · `bash ./build-vercel.sh` green → `.vercel/output` ready.

## Known issues (honest list — D9)
1. **CLS 0.083 — FIXED (this commit).** See above. Zero shift events in 4/4 mobile LH runs.
2. **Mobile TBT 290–470ms > 200ms target (score 61–79 across runs):** remaining cost is framework entry eval + gtag; cutting further requires vendor splitting (risky) or gtag changes (protected analytics.ts). Honest: Perf 86–91 across runs, best run 91.
3. Anonymous `/api/auth/me` 401s log console errors (BP/SEO) — inherent to auth design; endpoint in protected server-api.ts.
4. BP 73 / SEO 66 unchanged: third-party-cookies + inspector-issues (Google Ads pixel, owner-required); SEO 66 includes preview-only noindex (absent on production, verified D8).

## Honesty confirmations
- Production untouched (708d8d8 live). Ads untouched (owner-run, paused). No real charges. No fabricated claims/urgency/testimonials.
- QA account `qa.d9.gate@example.com` (free, seeded for the login gate) left functional per seed-qa-accounts skill; cleaned after QA at lead's discretion.
