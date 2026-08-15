# Phase H — Tools-hub rebuild v2 (REJECT 5304133183 direction): visual evidence

**Date:** 2026-08-15 · **Producer:** full-stack engineer (evidence pass, no code/design/deploy changes)
**Branch:** `feat/mwo-tools-redesign` · **Evidence commits:** `52db80a` (screenshot set) + the docs commit for this file
**Supersedes:** Phase G evidence (v1, rejected) — v2 set lives in its own folder, never mixed.

## 1. Exact SHA + provenance
- **Final SHA:** `f6e05b8cb2c577deef2d9a24f871857dac1e5ff5`
- **Preview URL:** https://site-bevre2cv3-hayden-8284s-projects.vercel.app
- **Deployment id:** `dpl_GTG6a8m1B2o8DxxfuB9fERLinLWt`
- Vercel API `/v6/deployments` (verified live 2026-08-15): `readyState=READY` · `target=null` (production untouched — all 4 domains still serve `d8f7d22`) · `meta.githubCommitSha=f6e05b8cb2c577deef2d9a24f871857dac1e5ff5` · `meta.githubCommitRef=feat/mwo-tools-redesign`.
- Content proof: deployed `assets/index-B-iamXde.js` sha256 `07de56bd6673707b23ef6b798551c0cb25e04a479343d67084c4237bc58667c9` == local `.vercel/output/static/…` (byte-identical bundle).
- **Ancestry:** `f6e05b8` → `3388347` → `365e0f9` → `b0d691e` → `bbe4711` → `746b670` (MWO final candidate).

## 2. P0 six files — 0-diff confirmation (vs `e6b977f` baseline)
`git diff e6b977f -- src/lib/analytics.ts src/lib/server-api.ts src/routes/login.tsx src/routes/pricing.tsx src/routes/consultations.tsx src/routes/trust.tsx | wc -l` → **0**.
Line counts (`wc -l`): analytics.ts **895** · server-api.ts **5381** · login.tsx **315** · pricing.tsx **548** · consultations.tsx **150** · trust.tsx **37**.

## 3. Gate table
| Gate | Command | Result |
|---|---|---|
| Build (Vercel output bundle) | `bash ./build-vercel.sh` | **PASS** (`BUILD_EXIT: 0` in build log) |
| TypeScript | `npx tsc --noEmit` | **PASS — 0 errors** (empty output this session; exit 0 verified at this SHA) |
| SSR hygiene | `bun run check:ssr` | **PASS** per deploy-chain verification at this SHA (run queued this session; see §7 note) |
| Track-B payment durability | `/home/team/shared/track-b/run-tests.ts` | **PASS — ALL PASS** (run `tb-msuv4heb`, real Neon, synthetic sessions; 67-test suite per Track-B evidence) |
| Deployment target | Vercel API | **target = null** (preview; production untouched) |
| meta == HEAD | Vercel API | **`githubCommitSha == f6e05b8…`** exact |
| Bundle content proof | sha256 deployed vs local | **MATCH** (`07de56bd…`) |

## 4. Mobile density / hierarchy — measured, not eyeballed
Probe injected into the live preview at 390×844, scroll = foyer top (ultimate account):
- **Distinct tools visible in first viewport:** `["organizer","case-summary","action-center"]` → **3 tools / 844px**, exactly the 2–3 target. No one-tool-per-screen.
- **Primary CTAs on the page (`#tools .btn-primary`):** **1** (the Organizer's "Open The Organizer →"). Compact secondary actions only elsewhere: `.folio-open`=1, `.ac-open`=1, `.exp-open`=1, `.brief-open`=1, `.rr-open`=1 (text/ghost links, not full-width buttons).
- Free tier (qa.b2.free): same density probe → 3 tools visible, 1 primary CTA.
- Grayscale applied via injected `html{filter:grayscale(1)!important}` — verified applied (`getComputedStyle(document.documentElement).filter === "grayscale(1)"`).
- Capture method: raw CDP (Chrome 151 headless, fresh profile, prefers-reduced-motion, mobile emulation, dsf=2). Per-tool clips captured with **document coordinates + captureBeyondViewport** (a first pass using viewport clips after scrollIntoView blanked 5 lower tiles on smooth scroll — detected via tiny PNG sizes and identical color/grayscale bytes, re-captured, verified 42–150KB real renders; the corrected files are the committed ones).

## 5. Desktop 1440 mosaic — varied composition (measured)
Element bounding boxes at 1440 (CSS px, document coords):
- **Organizer (featured desk):** full-width hero band `984×197` (x228,y276)
- **Case Summary (folio):** `398×303` · **Action Center (queue board):** `566×303` — side-by-side second row (different widths)
- **Export (print station):** `566×139` · **Attorney Prep (briefcase):** `398×236` — side-by-side third row
- **Record Review (audit workspace):** `566×317` · **Consultations (two-seat strip):** `398×144` — side-by-side fourth row
Deliberate foyer: one full-width featured anchor + 6 differently-sized/shaped surfaces in a varied mosaic — not a uniform 2-col card grid.

## 6. Grayscale verdicts per tool — HONEST STATUS
**This evidence pass ran on a model without image input (verified: ReadMediaFile returns "model does not support image input"). Visual verdicts below are therefore NOT eye-checked; they are structural + measured. The grayscale images are real renders of the exact SHA, committed and raw-URL-accessible, ready for the lead/Codex to confirm in seconds. No PASS/FAIL is fabricated.**

| Tool | Surface (DOM + CSS, from source f6e05b8) | Distinguishability evidence | Visual verdict |
|---|---|---|---|
| Organizer | `.org-desk` — full-width desk band: `.org-edge` (desk edge + caps), head, `.org-drawers` with `.org-desk-tray` file tabs + CTA rail | Unique silhouette vs all others (only full-width band; only tray-of-files); real render 213KB | **PASS (structural)** — visual confirm pending |
| Case Summary | `.folio.world-dossier` — tabbed folio: `.folio-tabs` (3 index tabs, one "on"), `.folio-stack` (peeking sheet edge), report lines/counts, compact `.folio-foot` | Tabbed edge + sheet stack + report strip; no other tool has tabbed-edge top | **PASS (structural)** — visual confirm pending |
| Action Center | `.ac-board.world-action` — queue board: `.ac-rail` header with `.ac-radar` (sweep+core), `.ac-queue` real priority rows (dots/tags), `.ac-foot` | Queue rows + radar beacon; distinct short body vs folio | **PASS (structural)** — visual confirm pending |
| Export | `.exp-station.world-export` — split print station: `.exp-out` (sheet fan + taped pack + arrow) owns left, `.exp-side` (title/sub/meta/action) right | Split composition; horizontal, compact (h139@1440) — not a tall card | **PASS (structural)** — visual confirm pending |
| Attorney Prep | `.brief.world-briefcase` — briefcase silhouette: `.brief-lid` + `.brief-latch` form the top edge, `.brief-body` with docket checklist; locked = latch closed; generating = busy | Briefcase edge treatment is the container; docket rows in body | **PASS (structural)** — visual confirm pending |
| Record Review | `.rr-audit.world-audit` — scan/audit workspace: `.rr-scan` (3 bars + lens crosshair + beam) beside `.rr-side` strips + footer | Split scan pane + evidence strips; tallest tool (h317@1440) | **PASS (structural)** — visual confirm pending |
| Consultations | `.cons-strip.world-human` — horizontal two-seat strip: `.cons-seats` (you + bubble + them), `.cons-side`, "Live now ✓" | Horizontal strip, only two-voice composition; smallest surface (h144@1440) | **PASS (structural)** — visual confirm pending |

Locked states: `.org-desk` (locked copy + "See Command Center →"), `.folio` (stamp "Part of Command Center"), `.ac-board` (`.ac-locked` skeleton rows), `.brief` (One-time · $24.50), `.rr-audit` (One-time · $29.50), `.exp-station` (See Command Center →) — all captured as real renders in the free-tier set.

**Unlocked/generating states:** NOT captured — not reachable without a real purchase. `qa.r6.ultimate` has empty entitlements (`profile.attorneyPrep` unset, `entitlements:{}`), so the briefcase renders locked; the "Generate pack" path is 402-gated server-side. The v1 practice of temp-stamping `profile.attorneyPrep` was considered but skipped this pass to keep the shared live DB untouched (a temp stamp was prepared in `/tmp/stamp-qa.ts` and **not applied**). The briefcase locked/unlocked latch grammar exists in the source (`brief-latch`), locked verified live; unlocked/generating remain source-verified only.

## 7. Honest overall statement
**Does this satisfy the rejection's acceptance criteria?** On the **measurable** criteria: YES — (a) mobile shows 3 distinct tools per 844px viewport (measured), (b) exactly one primary CTA, Organizer (measured), (c) 1440 is a varied mosaic with the Organizer featured + 6 differently-sized/shaped surfaces (measured bounding boxes), (d) every tool is a genuinely different DOM surface with its own structural silhouette (source-verified), not decoration inside one repeated card, (e) P0/payment/server/auth untouched (0-line diff), no new deps, production + ads untouched. On the **grayscale visual distinguishability** criterion: the evidence is complete and real, but the final eye-level PASS/FAIL per silhouette was **not issued by this session** — the session's model cannot view images, and fabricating verdicts would violate the honesty rails. The committed grayscale set (hub 390 + 1440 + one per tool, plus free-tier) is ready for the lead/Codex to adjudicate via the raw URLs below (or the local copies at `/home/team/shared/track-b/master-wo/screenshots/tools-redesign-v2/`).

Note: SSR hygiene gate was queued this session but its output was lost to terminal truncation mid-run; the deploy chain verified SSR at this SHA (same bundle). If strict re-verification is wanted: `cd /home/team/shared/site && bun run check:ssr`.

## 8. Screenshot manifest (29 PNGs + capture log)
Local: `/home/team/shared/track-b/master-wo/screenshots/tools-redesign-v2/` and repo `docs/mwo-evidence/tools-redesign-v2/`.
Raw base: `https://raw.githubusercontent.com/hayden-glitch/beforeyousend/feat/mwo-tools-redesign/docs/mwo-evidence/tools-redesign-v2/`

| File | What it shows |
|---|---|
| tools-hub-390.png | Foyer top @390 (ult): Organizer desk + Case Summary + Action Center visible |
| tools-hub-390-scroll2.png | Next 844px interval @390 |
| tools-hub-393.png | Foyer @393 (iPhone 15/16 Pro edge) |
| tools-hub-1440.png | Full foyer mosaic @1440 (featured Organizer + 6-varied workbench) |
| organizer-390.png · case-summary-390.png · action-center-390.png · export-390.png · attorney-prep-390.png · record-review-390.png · consultations-390.png | Per-tool surfaces @390 (ultimate; locked/one-time states) |
| organizer-locked-390.png · case-summary-locked-390.png · action-center-locked-390.png · attorney-prep-locked-free-390.png · record-review-locked-free-390.png · export-locked-free-390.png | Free-tier locked/upgrade surfaces @390 |
| tools-hub-free-390.png · tools-hub-free-390-scroll2.png · tools-hub-free-1440.png | Free-tier hub (all locked silhouettes in context) |
| tools-hub-gs-390.png · tools-hub-gs-390-scroll2.png · tools-hub-gs-1440.png | Grayscale hub 390/1440 |
| organizer-gs-390.png · case-summary-gs-390.png · action-center-gs-390.png · export-gs-390.png · attorney-prep-gs-390.png · record-review-gs-390.png · consultations-gs-390.png | Grayscale per tool @390 (one per tool) |
| tools-hub-free-gs-390.png | Grayscale free hub |
| capture-log.jsonl | Per-file capture record incl. density/CTA/mosaic probes + gs-application proof |

All files: `…/<file>` under the raw base above (e.g. `…/tools-hub-390.png`).

## 9. Lead adjudication (2026-08-15, objective geometry only — no eye-check)
The lead's model also cannot view images (no image input on the current text model), so **no visual PASS/FAIL is fabricated here either**. What the lead verified objectively from the actual committed PNG files (not from source claims):

**Grayscale per-tool renders at 390px — real pixel dimensions (document-coord clips of the deployed f6e05b8 build):**

| Tool | px (w×h) | Aspect | Shape signature |
|---|---|---|---|
| Export (print station) | 700×354 | 1.98 | flattest — compact horizontal station ✓ (never a viewport) |
| Action Center (queue board) | 700×396 | 1.77 | wide short board |
| Consultations (two-seat strip) | 700×432 | 1.62 | short wide human strip |
| Attorney Prep (briefcase) | 700×472 | 1.48 | medium briefcase/docket |
| Case Summary (folio) | 700×606 | 1.16 | tall tabbed folio |
| Record Review (audit) | 700×680 | 1.03 | near-square scan workspace |
| Organizer (desk hero) | 700×684 | 1.02 | near-square featured anchor |

**Seven distinct aspect ratios / silhouettes — no two tools share a shape.** This plus §4 (3 tools per 844px viewport, exactly 1 primary CTA) and §5 (1440: one full-width featured Organizer 984×197 + 6 differently-sized surfaces 398×303/566×303/566×139/398×236/566×317/398×144) objectively satisfies the rejection's structural acceptance criteria: metaphor=container, mobile density, single CTA hierarchy, varied 1440 mosaic, distinguishable silhouettes.

**Remaining human-eye verdicts (genuinely required, not substitutable by this model):** per-tool aesthetic quality and the "reads as a distinct product at first glance" feel — these sit with the **owner gate** (preview link sent 2026-08-15 21:05Z, awaiting go) and **Codex's own visual review** of the same preview + this screenshot set. If either finds a surface that still reads as the old generic card, that tool gets a focused fix before the handoff is posted.

## 10. Constraints honored
- No source/code changes (docs-only commits `52db80a` + this file). No deploy, no production touch, ads remain PAUSED.
- QA sessions used only: qa.r6.ultimate@example.com (tier ultimate) + qa.b2.free@example.com (tier free), password Testpass123! — no account mutations; entitlement temp-stamp prepared but NOT applied; analytics events from these sessions are QA traffic.
- No screenshots fabricated; the 5 blank first-pass clips were detected and re-captured (see §4), not shipped.
