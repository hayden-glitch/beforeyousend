# Phase I — The Room (Direction B) final visual evidence · SHA f7170ec
**Date:** 2026-08-15 · **Producer:** full-stack engineer (evidence pass — no code/design/deploy changes)
**Branch:** `feat/mwo-tools-redesign` · **Evidence commit:** docs-only commit carrying this file + `docs/mwo-evidence/tools-redesign-v3/` (29 PNGs + capture-log)
**Supersedes:** Phase H (v2, REJECT 5304270209 direction) — v3 set lives in its own folder, never mixed with `tools-redesign-v2/`.

## 1. Exact SHA + provenance
- **Final SHA:** `f7170ecce4ea805a7deb27b84cfda4062aef70b1` (`feat(tools): implement The Room foyer per DECISION.md (Direction B — design-first pick)`)
- **Preview URL:** https://site-a826vrsfc-hayden-8284s-projects.vercel.app · **Deployment:** `dpl_F4ANUjRwujySeeuLngDAXPbiC1Lu`
- Vercel API `/v13/deployments` (verified this session): `readyState=READY` · `target=null` (production untouched — all 4 domains still serve `d8f7d22`) · `meta.githubCommitSha=f7170ecce4ea805a7deb27b84cfda4062aef70b1` · `meta.githubCommitRef=feat/mwo-tools-redesign`.
- **Ancestry (exact git chain):** `f7170ec` → `3b29c64` → `03303df` → `52db80a` → `f6e05b8` → `3388347` → `365e0f9` → `b0d691e` → `bbe4711` → `746b670` (MWO final candidate).

## 2. Gate table
| Gate | Result | Evidence |
|---|---|---|
| TypeScript | **PASS — 0 errors** | `npx tsc --noEmit` at f7170ec: empty output, exit 0 (this session) |
| Track-B | **PASS — 67/67** | run `tb-msuyfvvd` on this SHA (lead-verified, real Neon) |
| Build + SSR hygiene | **PASS** | `bun run check:ssr` at f7170ec: "check:ssr PASS — 14 routes SSR-clean, no recovery markers." (this session) |
| Deployment target | **target = null** | Vercel API `target: null` (preview only) |
| meta == SHA | **MATCH** | `meta.githubCommitSha == f7170ec…` exact |
| P0 six files vs `e6b977f` | **0-line diff** | `git diff e6b977f -- src/lib/analytics.ts src/lib/server-api.ts src/routes/login.tsx src/routes/pricing.tsx src/routes/consultations.tsx src/routes/trust.tsx` → 0 |

## 3. Probes — measured on the live preview (raw CDP, Chrome 151, fresh profile, dsf=2 mobile emulation; normal viewport screenshots, not full-page captures)
### (a) Mobile density @390×844 (ultimate, foyer top)
`visible = [desk-organizer, folio-case-summary, console-action-center, tray-export, briefcase-attorney-prep]` → **5 distinct tools in the first 844px** (target ≥3 — PASS, exceeds). Only bench + seats fall below the fold (shelf 3). No one-tool-per-screen.
### (b) Primary CTA count @390
`#tools .cta-primary` = **1** (the desk's "Open the desk →"); `#tools .btn-primary` = **0**. Every other tool uses compact text links (`o-act a/button`, 44px min-height) — target exactly 1 → **PASS**.
### (c) Desktop 1440 — six-object bounding boxes: **FAIL (see §4)**
Only the desk renders (`desk 640×310 @ x=100, y=564`). All six `.obj` elements report **0×0** (`folio/console/tray/brief/bench/seats`).
### (d) Grayscale application proof
`getComputedStyle(document.documentElement).filter === "grayscale(1)"` (injected `html{filter:grayscale(1)!important}`) — verified before every gs capture. Color vs gs fingerprint of the same hub shot is nearly identical (density 1.5% vs 1.4%, comY 0.56 vs 0.59) → the filter was active and did not alter composition.

## 4. CRITICAL FINDING — desktop ≥900px renders only the desk (six objects hidden)
**Measured live at 1440:** every `.obj` element (`folio/console/tray/brief/bench/seats`) has `getBoundingClientRect() = 0×0`; `getComputedStyle` shows `display:flex; position:absolute` but their parent `.shelf` is `display:none` at `≥900px` (app.css:2306 `.shelf { display:none }` — the only two `.shelf` rules in the file are the mobile grid at 1688 and this hide at 2306; no `display:contents` anywhere). `.room-scene` children = `[desk, shelf, shelf, shelf, room-floor]` — the DOM has the six objects but CSS hides them at desktop.
**Measured consequence in the real 1440 render** (`tools-hub-1440.png`, fingerprint): right-third horizontal ink = **2%** (color) / **0%** (gs) — the right half of the scene is blank wall/floor; the intended six objects (which the ≥1200px block positions as `.console` right:56px, `.folio` right:5.18%, `.tray` left:4.14%, `.brief` right:31.07%, `.bench` left:26.33%, `.seats` right:4.14%) are absent. Density 1.5% vs the mobile hub's 12.9%.
**Verdict:** the "full room scene — wall + floor + six objects, varied composition" acceptance criterion **FAILS at this SHA**. This is a genuine implementation defect in f7170ec (the desktop positioning rules exist and are correct, but the shelf wrapper hides them). **No code change was made (evidence pass).** Likely one-line fix for the implementer: in the `≥900px` media query change `.shelf { display:none }` → `.shelf { display:contents }` so the absolutely-positioned objects escape to `.room-scene`. This must be fixed + re-deployed + re-evidenced before any handoff.
**Note:** the CSS comment claims "verified 900–1199" geometry — that verification was evidently not run against a real render at desktop width, or was run against an earlier draft. The per-tool 390 renders in this set are unaffected (mobile shelf grid shows all seven tools).

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
**Desktop silhouettes: NOT FINGERPRINTABLE at this SHA** — the six objects do not render at 1440 (§4); the gs-1440 shot is the honest current state (desk + wall + floor, right-third ink 0%).

## 6. Free-tier (qa.b2.free) — locked states, real renders
- Same density: **5 tools visible**, **1** primary CTA (the desk's).
- Desk shows the **trial** state ("Open the desk →" / "In your plan" — this account has an active 5-item Organizer trial; the `See Command Center →` desk-locked variant exists in source for accounts without a trial).
- Locked/upgrade states captured: folio "See Command Center → · Part of Command Center", console "See Command Center →" (+ skeleton rows), tray "See Command Center →", briefcase "One-time · $24.50" + "See the pack →", bench "$29.50" + "See Record Review →".
- Ultimate account states captured: bench shows "Used for this year" + "Buy another — $29.50" (this QA account already used its yearly Record Review — real data-driven state, not mocked).

## 7. Honest overall statement vs the acceptance bar
**Does The Room at SHA f7170ec clear the rejection's acceptance criteria? NO — not at this SHA.**
- ✅ Mobile density: **PASS** — 5 tools per 844px viewport @390 (≥3 target).
- ✅ Single primary CTA: **PASS** — exactly 1 (`#tools .cta-primary`), 0 secondary primary buttons.
- ✅ Per-tool silhouettes @390: **PASS (measured)** — 7/7 distinct surfaces, max pairwise profile corr 0.537.
- ✅ Status-in-metaphor, premium calm, real-data states: **PASS** (structural/source + probes).
- ❌ **Desktop 1440 composition: FAIL** — the six objects are hidden at ≥900px (`display:none` on `.shelf` parents); the scene renders only the desk. The desktop scene cannot be shown with "wall + floor + six objects" because the build does not render them. Right-third ink 0% in the gs-1440 render.
Because criterion 5 of the acceptance bar (deliberate desktop command-center composition, not a card grid) fails, the overall bar is **NOT cleared** until the one-line `.shelf { display:contents }` fix is made, re-deployed, and re-evidenced. Mobile is ready; desktop needs the fix. This is exactly the kind of defect the evidence pass exists to catch — **do not post the handoff from this SHA.**

## 8. Screenshot manifest (29 PNGs + capture-log)
Local: `/home/team/shared/track-b/master-wo/screenshots/tools-redesign-v3/` and repo `docs/mwo-evidence/tools-redesign-v3/`.
Raw base: `https://raw.githubusercontent.com/hayden-glitch/beforeyousend/feat/mwo-tools-redesign/docs/mwo-evidence/tools-redesign-v3/`
| File | What it shows |
|---|---|
| tools-hub-390.png | Foyer top @390×844 (ultimate) — 5 tools in first viewport |
| tools-hub-390-scroll2.png | Next 844px interval @390 (shelf 3 + floor + foot) |
| tools-hub-393.png · tools-hub-430.png | Edge widths (iPhone 15 Pro / Pro Max) |
| tools-hub-1440.png | Desktop scene @1440 — **desk + wall + floor only (six objects hidden — see §4)** |
| desk-organizer-390.png · folio-case-summary-390.png · console-action-center-390.png · tray-export-390.png · briefcase-attorney-prep-390.png · bench-record-review-390.png · seats-consultations-390.png | Per-tool surfaces @390 (ultimate/real states) |
| desk-organizer-gs-390.png · folio-case-summary-gs-390.png · console-action-center-gs-390.png · tray-export-gs-390.png · briefcase-attorney-prep-gs-390.png · bench-record-review-gs-390.png · seats-consultations-gs-390.png | Grayscale per tool @390 (fingerprint set) |
| tools-hub-gs-390.png | Grayscale hub @390 |
| tools-hub-gs-1440.png | Grayscale desktop @1440 — honest current state (desk only, right-third ink 0%) |
| tools-hub-free-390.png · tools-hub-free-390-scroll2.png | Free-tier hub @390 (locked states in context) |
| desk-organizer-locked-free-390.png · folio-case-summary-locked-free-390.png · console-action-center-locked-free-390.png · tray-export-locked-free-390.png · briefcase-attorney-prep-locked-free-390.png · bench-record-review-locked-free-390.png | Free-tier per-tool locked/upgrade surfaces @390 |
| capture-log.jsonl | Per-file capture record incl. density/CTA/desktop probes + gs proof |
All files: `…/<file>` under the raw base above.

## 9. Design-first provenance
- Implementation built from `docs/mwo-evidence/design-comps-v3/DECISION.md` — **pick B · The Room** (PASS; A partial, C fail) — the design-first adjudication (2026-08-15) whose acceptance bar is quoted in DECISION.md §0 and in the comps at `/home/team/shared/track-b/master-wo/design-comps-v3/b/` (desktop-1440.png / mobile-390.png / silhouettes). The implementation's DOM+CSS match the DECISION.md §3 contract for every object (desk/furniture classes, world tokens, single `.cta-primary`, price chips, `See Command Center →` links) — verified from source this session. The desktop hide defect (§4) is a CSS delivery error against the contract, not a contract error.

## 10. Constraints honored
- No source/code changes (this evidence commit is docs-only). No deploy, no production touch, ads remain PAUSED.
- QA sessions used only: qa.r6.ultimate@example.com (ultimate) + qa.b2.free@example.com (free), both via temporary `bys_auth_sessions` rows created for this pass and deleted afterwards; no account mutations; analytics events from these sessions are QA traffic.
- No screenshots fabricated; the desktop 1440 shot is the true render of the deployed build (and the probes prove why it is sparse). No CSS was injected to fake the six objects.
- The desktop defect is reported as a FAIL, not papered over; the one-line fix suggestion is advisory only (implementer's call, outside this evidence pass).
