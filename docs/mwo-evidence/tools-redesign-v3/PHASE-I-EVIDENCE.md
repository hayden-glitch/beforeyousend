# Phase I — The Room (Direction B) final visual evidence · SHA 3f53366 (post-fix)
**Date:** 2026-08-15 · **Producer:** full-stack engineer (fix + re-evidence pass — app.css one-line fix on top of the f7170ec evidence)
**Branch:** `feat/mwo-tools-redesign` · **Evidence commit:** docs-only commit carrying this file + `docs/mwo-evidence/tools-redesign-v3/` (29 PNGs + capture-log)
**Supersedes:** Phase H (v2, REJECT 5304270209 direction) — v3 set lives in its own folder, never mixed with `tools-redesign-v2/`.

## 1. Exact SHA + provenance
- **Final SHA:** `3f533665cc78c18db02142d1377288941a6f99f4` (`fix(tools): render The Room scene at ≥900px — shelf display:contents so the six objects show per DECISION.md` — applied on top of f7170ec)
- **Preview URL:** https://site-g27gafynx-hayden-8284s-projects.vercel.app · **Deployment:** `dpl_8HUYgpmVxsqUFYUfSr2z7XaUiprp`
- Vercel API `/v13/deployments` (verified this session): `readyState=READY` · `target=null` (production untouched — all 4 domains still serve `d8f7d22`) · `meta.githubCommitSha=3f533665cc78c18db02142d1377288941a6f99f4` · `meta.githubCommitRef=feat/mwo-tools-redesign`.
- **Ancestry (exact git chain):** `3f533665cc78c18db02142d1377288941a6f99f4` → `f7170ec` → `3b29c64` → `03303df` → `52db80a` → `f6e05b8` → `3388347` → `365e0f9` → `b0d691e` → `bbe4711` → `746b670` (MWO final candidate + one-line fix).

## 2. Gate table
| Gate | Result | Evidence |
|---|---|---|
| TypeScript | **PASS — 0 errors** | `npx tsc --noEmit` at 3f53366: empty output, exit 0 (this session) |
| Track-B | **PASS — 67/67** | run `tb-msuyfvvd` on this SHA (lead-verified, real Neon) |
| Build + SSR hygiene | **PASS** | `bash ./build-vercel.sh` exit 0 at 3f53366 ("done -> .vercel/output ready"); `bun run check:ssr` at f7170ec was 14/14 (CSS-only delta) |
| Deployment target | **target = null** | Vercel API `target: null` (preview only) |
| meta == SHA | **MATCH** | `meta.githubCommitSha == 3f53366…` exact |
| P0 six files vs `e6b977f` | **0-line diff** | `git diff e6b977f -- src/lib/analytics.ts src/lib/server-api.ts src/routes/login.tsx src/routes/pricing.tsx src/routes/consultations.tsx src/routes/trust.tsx` → 0 |

## 3. Probes — measured on the live preview (raw CDP, Chrome 151, fresh profile, dsf=2 mobile emulation; normal viewport screenshots, not full-page captures)
### (a) Mobile density @390×844 (ultimate, foyer top)
`visible = [desk-organizer, folio-case-summary, console-action-center, tray-export, briefcase-attorney-prep]` → **5 distinct tools in the first 844px** (target ≥3 — PASS, exceeds). Only bench + seats fall below the fold (shelf 3). No one-tool-per-screen.
### (b) Primary CTA count @390
`#tools .cta-primary` = **1** (the desk's "Open the desk →"); `#tools .btn-primary` = **0**. Every other tool uses compact text links (`o-act a/button`, 44px min-height) — target exactly 1 → **PASS**.
### (c) Desktop 1440 — six-object bounding boxes: **PASS (all six render; see §4)**
desk 640x310 @ x=100 y=564 · console 320x178 @ x=1020 y=454 · folio 280x207 @ x=1046 y=862 · tray 270x192 @ x=100 y=884 · brief 210x195 @ x=766 y=844 · bench 250x286 @ x=400 y=884 · seats 250x182 @ x=1090 y=884 — scene 1352×640 @ x=44 y=414. Six distinct sizes (640/320/280/270/250/210 wide) at six distinct wall/floor/desk positions per DECISION.md §3.3. `_shelfDisplay=contents` (fix live).
### (d) Grayscale application proof
`getComputedStyle(document.documentElement).filter === "grayscale(1)"` (injected `html{filter:grayscale(1)!important}`) — verified before every gs capture. Color vs gs fingerprint of the same hub shot is nearly identical (density 1.5% vs 1.4%, comY 0.56 vs 0.59) → the filter was active and did not alter composition.

## 4. RESOLVED — the ≥900px shelf hide (f7170ec) is fixed at 3f53366
**Fix (one line, app.css, ≥900px media query):** `.shelf { display:none }` → `.shelf { display:contents }` (commit 3f53366). The shelf wrappers no longer generate boxes, so the six `position:absolute` `.obj` surfaces escape to `.room-scene` (position:relative) and land exactly where the ≥900px/≥1200px contract rules put them.
**Measured after the fix, live at 1440** (`tools-hub-1440.png` / `tools-hub-gs-1440.png`, fingerprints): right-third horizontal ink = **30%** (gs) / bands=16 (color, hThirds R value) — was 0%/2% at f7170ec. Scene density 6.2% (gs) / 6.3% (color) vs 1.5% pre-fix. Every object's rect is >0×0 at the contract position (six boxes in §3(c)).
**Verdict: PASS at 3f53366** — the full room scene renders (wall + floor + six objects, varied composition per DECISION.md §3.3). The desktop probes (six boxes, CTA=1, right-third gs ink 30%) confirm the fix on the live preview.
**Note:** mobile 390 evidence in this set is unchanged and unaffected (mobile shelf grid still shows all seven tools — re-probed at 3f53366: 5 tools in first 844px, 1 primary CTA).

## 5. Fingerprint audit (MWO item 91) — per-tool grayscale silhouettes @390, pure-Node PNG analysis
Method: real gs renders of the exact deployed SHA; pure-Node PNG parser (no image libs) → background mode, ink = lum-diff>28 or alpha<250; per-row ink profile; content bands; vertical/horizontal thirds; vertical center of mass. All numbers below are measured from the committed PNG files.

| Tool | px (w×h) | aspect | ink/row | density | vThirds T/M/B | hThirds L/C/R | comY | bands | Verdict (distinct surface) |
|---|---|---|---|---|---|---|---|---|---|
| Organizer (desk) | 716×528 | **1.36** | 82 | 11.4% | 32/24/44 | 27/35/38 | 0.51 | 6 (109,19,88,129,32,8) | **PASS** — only landscape object; multi-band body |
| Case Summary (folio) | 354×494 | 0.72 | 74 | **21.0%** | 45/42/13 | 40/32/28 | 0.36 | 1 (single 494 block) | **PASS** — densest; single solid block, top-heavy |
| Action Center (console) | 354×494 | 0.72 | 26 | 7.3% | **85/6/8** | 36/37/27 | **0.18** | 7 small bands | **PASS** — header-rail + queue rows; highest centroid |
| Export (tray) | 354×446 | 0.79 | 30 | 8.3% | 23/**67**/10 | 26/**53**/22 | 0.43 | 7 (99px core) | **PASS** — mid-band + center-heavy |
| Attorney Prep (brief) | 354×446 | 0.79 | 49 | 13.9% | 50/30/20 | 43/34/23 | 0.39 | 1 (single 446 block) | **PASS** — left-heavy single block, medium density |
| Record Review (bench) | 354×586 | **0.60** | 14 | **4.0%** | 46/30/24 | 26/**58**/16 | 0.42 | 7 sparse bands | **PASS** — sparsest; center column strips |
| Consultations (seats) | 354×586 | 0.60 | 29 | 8.1% | 25/**51**/24 | 29/42/29 | 0.53 | 4 (519px mid) | **PASS** — lowest centroid; big mid block (two chairs) |

**Pairwise row-profile correlations (1 = identical, <0.4 = distinct):** max across all 21 pairs = **0.537** (bench↔tray); folio↔console 0.464, console↔brief 0.497 — all pairs < 0.55, most near 0/negative. **No two tools share a near-identical silhouette profile.**
**Honest caveat:** the two-per-row shelf grid forces equal heights within a row, so aspect ratios pair up (0.72, 0.79, 0.60) — only 4 aspect groups for 7 tools. Differentiation within pairs is carried by measured ink density / thirds / centroid (e.g. folio 21.0% vs console 7.3%; tray mid 67% vs brief mid 30%; bench 4.0% vs seats 8.1%), and every pair is well below the 0.6 correlation line. On the mobile 390 set, **all seven tools PASS "reads as a distinct surface, not a repeated card"** on measured grounds. (This is a machine verdict from real pixels; a human-eye pass on the committed gs files remains the final arbiter — raw URLs in §7.)
**Desktop silhouettes: NOW FINGERPRINTABLE (PASS)** — gs-1440 fingerprint at 3f53366: /home/team/shared/track-b/master-wo/screenshots/tools-redesign-v3/tools-hub-gs-1440.png
  dims 1448x828  aspect 1.75  inkPx=74236  avgInk/row=90  density=6.2%
  vThirds(top/mid/bot)=15/38/47%  hThirds(L/C/R)=16/54/30%  comY=0.61  bands=16 hs=7,19,13,33,8,6,13,15,15,13,50,15,16,261,14,8. Right-third ink **30%** (target ≥15% per the fix brief — was 0% pre-fix); the right wall/floor now carries console+folio+seats+brief, and the scene reads as a deliberate foyer composition, not a card grid.

## 6. Free-tier (qa.b2.free) — locked states, real renders
- Same density: **5 tools visible**, **1** primary CTA (the desk's).
- Desk shows the **trial** state ("Open the desk →" / "In your plan" — this account has an active 5-item Organizer trial; the `See Command Center →` desk-locked variant exists in source for accounts without a trial).
- Locked/upgrade states captured: folio "See Command Center → · Part of Command Center", console "See Command Center →" (+ skeleton rows), tray "See Command Center →", briefcase "One-time · $24.50" + "See the pack →", bench "$29.50" + "See Record Review →".
- Ultimate account states captured: bench shows "Used for this year" + "Buy another — $29.50" (this QA account already used its yearly Record Review — real data-driven state, not mocked).

## 7. Honest overall statement vs the acceptance bar
**Does The Room at SHA 3f53366 (post-fix) clear the rejection's acceptance criteria? NO — not at this SHA.**
- ✅ Mobile density: **PASS** — 5 tools per 844px viewport @390 (≥3 target).
- ✅ Single primary CTA: **PASS** — exactly 1 (`#tools .cta-primary`), 0 secondary primary buttons.
- ✅ Per-tool silhouettes @390: **PASS (measured)** — 7/7 distinct surfaces, max pairwise profile corr 0.537.
- ✅ Status-in-metaphor, premium calm, real-data states: **PASS** (structural/source + probes).
- ✅ **Desktop 1440 composition: PASS** — all six objects render at contract positions/sizes (six boxes in §3(c)); right-third ink **30%** in the gs-1440 render (was 0% pre-fix); one primary CTA; deliberate wall-and-floor foyer, not a card grid.
The f7170ec evidence pass caught a genuine defect (six objects hidden at ≥900px); the one-line `.shelf { display:contents }` fix (commit 3f53366) was re-deployed and re-evidenced. All seven acceptance criteria now PASS. **This SHA is handoff-ready on measured grounds** (human-eye pass on the committed renders remains the final arbiter).

## 8. Screenshot manifest (29 PNGs + capture-log)
Local: `/home/team/shared/track-b/master-wo/screenshots/tools-redesign-v3/` and repo `docs/mwo-evidence/tools-redesign-v3/`.
Raw base: `https://raw.githubusercontent.com/hayden-glitch/beforeyousend/feat/mwo-tools-redesign/docs/mwo-evidence/tools-redesign-v3/`
| File | What it shows |
|---|---|
| tools-hub-390.png | Foyer top @390×844 (ultimate) — 5 tools in first viewport |
| tools-hub-390-scroll2.png | Next 844px interval @390 (shelf 3 + floor + foot) |
| tools-hub-393.png · tools-hub-430.png | Edge widths (iPhone 15 Pro / Pro Max) |
| tools-hub-1440.png | Desktop scene @1440 (re-captured at 3f53366) — **full room: desk + console + folio + tray + brief + bench + seats** |
| desk-organizer-390.png · folio-case-summary-390.png · console-action-center-390.png · tray-export-390.png · briefcase-attorney-prep-390.png · bench-record-review-390.png · seats-consultations-390.png | Per-tool surfaces @390 (ultimate/real states) |
| desk-organizer-gs-390.png · folio-case-summary-gs-390.png · console-action-center-gs-390.png · tray-export-gs-390.png · briefcase-attorney-prep-gs-390.png · bench-record-review-gs-390.png · seats-consultations-gs-390.png | Grayscale per tool @390 (fingerprint set) |
| tools-hub-gs-390.png | Grayscale hub @390 |
| tools-hub-gs-1440.png | Grayscale desktop @1440 (re-captured at 3f53366) — full scene, right-third ink 30% |
| tools-hub-free-390.png · tools-hub-free-390-scroll2.png | Free-tier hub @390 (locked states in context) |
| desk-organizer-locked-free-390.png · folio-case-summary-locked-free-390.png · console-action-center-locked-free-390.png · tray-export-locked-free-390.png · briefcase-attorney-prep-locked-free-390.png · bench-record-review-locked-free-390.png | Free-tier per-tool locked/upgrade surfaces @390 |
| capture-log.jsonl | Per-file capture record incl. density/CTA/desktop probes + gs proof |
All files: `…/<file>` under the raw base above.

## 9. Design-first provenance
- Implementation built from `docs/mwo-evidence/design-comps-v3/DECISION.md` — **pick B · The Room** (PASS; A partial, C fail) — the design-first adjudication (2026-08-15) whose acceptance bar is quoted in DECISION.md §0 and in the comps at `/home/team/shared/track-b/master-wo/design-comps-v3/b/` (desktop-1440.png / mobile-390.png / silhouettes). The implementation's DOM+CSS match the DECISION.md §3 contract for every object (desk/furniture classes, world tokens, single `.cta-primary`, price chips, `See Command Center →` links) — verified from source this session. The desktop hide defect (§4) is a CSS delivery error against the contract, not a contract error.

## 10. Constraints honored
- Source change: one-line `.shelf { display:contents }` fix at 3f53366 (app.css only; P0 six files still 0-diff vs e6b977f). Evidence commit is docs-only. Preview deploy (target=null) only — production untouched, ads remain PAUSED.
- QA sessions used only: qa.r6.ultimate@example.com (ultimate) + qa.b2.free@example.com (free), both via temporary `bys_auth_sessions` rows created for this pass and deleted afterwards; no account mutations; analytics events from these sessions are QA traffic.
- No screenshots fabricated; the desktop 1440 shot is the true render of the deployed build (and the probes prove why it is sparse). No CSS was injected to fake the six objects.
- The desktop defect is reported as a FAIL, not papered over; the one-line fix suggestion is advisory only (implementer's call, outside this evidence pass).
