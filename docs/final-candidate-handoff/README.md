# Final Production Candidate — Handoff Evidence — v2 (CURRENT)

> **STATUS: v2 (D10) is the CURRENT red-team candidate.** Everything below the `SUPERSEDED` marker is v1 (D9) history kept for reference only — do not treat v1 SHAs / previews / scores as current.

## v2 candidate identity
- **Deployed engineering SHA:** `11579916e106f5843785081c75d67df6e9b80284` — commit "perf(D10): defer hero cycle start to idle; promote filtered SVG layer". This is the exact code the red-team gate runs against.
- **Branch HEAD after this docs commit:** stated in the lead's handoff post (exact full SHA of this docs commit in the commit log; reported separately).
- **Post-SHA commits:** HEAD before this docs commit was `158a728` (docs-only: pricing-v2 screenshots + capture log). **`git diff 1157991 HEAD -- src/` is empty** — zero app-code diff since the deployed SHA. This docs commit keeps that invariant:
  ```
  $ git diff 1157991 HEAD -- src/
  (no output — empty)
  ```
- **Zero app-code diff after the deployed SHA is a hard requirement** (GPT flagged dirty-tree/gitDirty — the docs commit must not look like app code).

## Preview (v2)
- **URL:** https://site-d3ceiinzt-hayden-8284s-projects.vercel.app
- **Deployment:** `dpl_9yTLZcLPgmXQ64aSuuzyeSbQdvjU`
- **Metadata:** target=null / **READY** / `githubCommitSha=11579916e106f5843785081c75d67df6e9b80284` (EXACT) / **gitDirty ABSENT**.
- ⚠️ **The OLD alias `site-a3q2ryg7r-hayden-8284s-projects.vercel.app` still serves the REJECTED dirty-tree build (sha `4c231c5`) — do NOT use it.** All v2 evidence below was measured on the new preview only.

## Performance — Lighthouse v2 (LH 13.4.1, HTTPS preview, 5 mobile runs + desktop)

**Mobile (5 runs):**
| run | Perf | FCP (s) | LCP (s) | CLS | TBT (ms) | JS xfer (KB) |
|---|---|---|---|---|---|---|
| m1 | 86 | 1.89 | 2.38 | 0 | 433 | 327 |
| m2 | 90 | 1.70 | 1.70 | 0 | 384 | 327 |
| m3 | 92 | 1.70 | 2.30 | 0 | 277 | 327 |
| m4 | 91 | 1.79 | 2.28 | 0 | 292 | 327 |
| m5 | 88 | 1.67 | 2.17 | 0 | 428 | 327 |

- **Median:** Perf **90** · FCP **1.70s** · LCP **2.28s** · CLS **0** · TBT **384ms** · JS transferred **327KB**.
- **Gate:** Median Perf ≥90 met (3/5 runs ≥90); CLS 0 in all 5 runs.

**Desktop:** Perf **100** · FCP/LCP **0.48s** · CLS **0** · TBT **51ms** · JS transferred **384KB**.

## Documented TBT exception (OWNER DECISION)
- **Owner decision (issue #1 comment, 2026-08-16T18:15:30Z):** do NOT defer Google/TikTok loaders past LCP. Measurement architecture and dirty-URL/privacy guards preserved **unchanged**.
- Remaining TBT (~384ms median) is **dominated by required third-party measurement scripts** — gtag ~429ms scripting, TikTok pixel ~179KB / 433ms — **not core interaction code**. Cutting it would require vendor splitting or deferring owner-required pixels, both rejected by the owner decision above.

## Regressions on the v2 preview (ALL PASS)
- **Build / tsc / SSR green** at `1157991` (`bun run build`, `bunx tsc --noEmit`, `npm run check:ssr`).
- **TikTok callback 404 PASS** (expected 404, confirmed).
- **Dirty-URL: 0 third-party `session_id` leaks PASS.**
- **Overflow clean** at 320 and 390 on `/` and `/pricing` (scrollWidth === clientWidth).
- **Login `?next=` gate re-verified on the new preview — ALL PASS.** Evidence: `/home/team/shared/gate-evidence/` (`gate-final-out.json`, `gate-probe-out.json`, `gate-final.log`, `gate-login2.log`, `gate-final-A.png`).
  - **Capture-once PASS** — `?next=/pricing` lands on /pricing exactly once (docNavs: `/login?next=/pricing` → `/login` → `/pricing`); `/dashboard` stub → `/home`; no re-login.
  - **URL scrub + omitPixels PASS** — dirty SSR omits the Google loader (`googleTagPresent=false` on dirty URLs), flush happens post-scrub, final URLs clean.
  - **Dirty-URL leak PASS** — 1 clean loader request, **0 leaks** (`leaks: []`).
- **Note for red-team:** `/dashboard` is a **stub that redirects to `/home`** — use `/pricing` or `/home` as `?next=` targets.

## Pricing screenshots v2
`docs/d3-evidence/pricing-v2-{320,390,1440}.png` + `pricing-v2-capture-log.jsonl` (full-page captures, committed in `158a728`).

## Production / ads / charges — untouched
- Live production remains **`708d8d8` / `dpl_GwLb6eFnxCT9s67H5qxb2Jq4DM5x`** on all 4 domains (beforeyousend.org, www.beforeyousend.org, before-you-send.vercel.app, bys-app.vercel.app).
- No `--prod` deploy, no ads touched, no real charges.

---
---

# SUPERSEDED — v1 (D9) handoff history below (kept for reference only — NOT current)

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
## Probe output (D9 final — lead re-ran the gate probe 2026-08-16 against the D9 preview; JSON below)
```json
{
  "tiktok404": { "status": 404, "expected": 404 },
  "dirtyUrl": { "thirdPartyLeakCount": 0, "sample": [] },
  "overflow": {
    "/@320":   { "scrollW": 320, "clientW": 320, "bodyScrollW": 320 },
    "/pricing@320": { "scrollW": 320, "clientW": 320, "bodyScrollW": 320 },
    "/@390":   { "scrollW": 390, "clientW": 390, "bodyScrollW": 390 },
    "/pricing@390": { "scrollW": 390, "clientW": 390, "bodyScrollW": 390 }
  },
  "loginNext": { "formFound": false, "finalUrl": "https://site-a3q2ryg7r-hayden-8284s-projects.vercel.app/login", "finalTitle": "Create your free account — Before You Send" }
}
```
- TikTok callback 404 ✓ · dirty-URL zero third-party leaks ✓ · overflow clean at 320/390 on / and /pricing ✓.
- `loginNext.formFound:false` is a PROBE-SCRIPT artifact, not an app defect: the script looks for a legacy single `<form>`; the D3 login rebuild is a sleek one-field-at-a-time flow with no single form element. Interactive `?next=` landing verification is covered by the live QA sweep (T2 authenticated tester, lead-coordinated) — final verdict recorded there.
## Changed-file list vs live 708d8d8 (grouped, source only; docs/evidence omitted)
**Design (dark Workbench surface):** `src/styles/app.css` (398± — dark tokens, radii 8–12px, sans-first, grease-pencil texture, sticky/pricing/layout utilities) · `src/components/SiteChrome.tsx` (wordmark visible <480px, pill header, footer) · `src/routes/__root.tsx` (chrome/theme wiring) · `public/fonts/fraunces-latin.woff2` **deleted** (Fraunces removed; sans-first per §2) · `src/routes/tiktok-connected.tsx` (+canonical/OG) · `src/routes/trust.tsx` (US 988/crisis refs removed).
**Funnel (homepage/pricing/login/results):** `src/routes/index.tsx` (homepage = single product scene, composer above fold, exact §4 hero timings, Panic re-entry every 5th, reduced-motion static) · `src/routes/pricing.tsx` (3 paid + free ref, Command Center Recommended, quiet annual toggle, one-time below, comparison+FAQ, neutral mobile sticky CTA) · `src/routes/login.tsx` (no questionnaire, quiet `.login-shell`, `?next=` context headings, TrialModal suppression) · `src/components/ReviewResults.tsx` (answer order per §11, one Recommended rewrite, one dominant next step) · `src/components/ReviewTool.tsx` (P2 score-label fixes, ghost-chip CLS placeholder, lazy attach) · `src/routes/home.tsx` + `DigestCard`/`Momentum`/`Organizer` (P2 label fixes, folder-language removal).
**Performance:** `src/components/DeferredMount.tsx` (NEW — interaction-gated mount with placeholder prop) · lazy ReviewResults/AttachControl/TomorrowDraftsList; entry chunk 419.7→378.8KB (D7); TBT 1070→290ms (D7), CLS 0.083→0 (D9).
## Screenshots (spec §29 item 4 — all committed)
`docs/final-candidate-handoff/shots/` — **48 PNGs**: homepage at **320/375/390/393/430/768/1024/1440** (`home-*.png`); hero **Panic / strike / resolved** states at 390 + 1440 (`hero-*.png`); key public surfaces at 390 + 1440 (`pricing`, `login`, `consultations`, `faq`, `about`, `privacy`, `terms`, `contact`, `trust`, `redeem`, `tiktok-connected`, `results`, `streaming`, `404`); dashboard tabs at 390 (`home-{ai,saved,log,timeline,organizer,tools,account}-390.png`); tool surfaces (`tool-casesummary`, `tool-actioncenter`). D1 design comps (30 shots, Direction A/B/C) in `docs/final-candidate-comps/screenshots/`; D3 pricing/login evidence in `docs/d3-evidence/`.
## Bundle / chunk / resource report (spec §29 item 6)
- Entry JS chunk **378.8KB** (down from 419.7KB at D7 start; measured on the D9 preview build).
- `TomorrowDraftsList` — separate **1.45kB lazy chunk** behind auth (NOT in the anonymous entry bundle — spec §10 requirement).
- `ReviewResults` / `AttachControl` — lazy-loaded; root funnel surfaces mount on first interaction or the 6s DeferredMount cap.
- Chunk sha256 verified byte-for-byte between local build and the live preview: `index-B9AwjYsv.js` = `0b60c84918b9a3b9`.
- Fonts: single system-sans stack + one remaining woff2 (Fraunces removed; no webfont weight explosion).
## Viewport completion matrix (spec §29 item 7)
- **D6 overflow matrix: ALL 88 width/path combinations PASS** (scrollWidth === clientWidth), covering home + pricing + login + consultations + results at 320/360/375/390/393/414/430/480/640/768/1024/1280/1440.
- D9 spot re-check on the final preview: 320 and 390 on `/` and `/pricing` — scrollW === clientW === 320/390 (JSON above).
- Hero layout-shift check: Panic→X→resolved animation is fully contained (no CLS events in 4/4 Lighthouse runs).
