# Phase G — Tools-hub redesign corrective (HOLD 5303879888): final evidence

**Branch:** `feat/mwo-tools-redesign` (parent of the corrective is the MWO final `746b670`).
**Corrective commit:** `d677df669d761d72482056b73811ee1dd0f35176` — `fix(tools-hub): seven distinct silhouettes for the Command Center foyer (HOLD 5303879888)`.
**Parent:** `746b670e2dd811dec201154e2d49dde03f280bbf` (MWO final candidate, Phase-E P2).
**Docs/evidence commit (this artifact set):** `ee7cbf9ff3bf542a3446cfb21e88e9b936a0ff31` — `docs(mwo-evidence): Tools-hub redesign screenshots (HOLD 5303879888)`. Screenshots live in `docs/mwo-evidence/tools-redesign/` and are viewable via raw.githubusercontent.com (branch `feat/mwo-tools-redesign`).

## 1. Changed files (corrective d677df6, vs parent 746b670)
- `src/routes/home.tsx` — Tools-hub card markup: each room preview now uses its own silhouette/composition (filing-desk tray, dossier band, queue rows + radar, print package, briefcase latch, audit lens, two-seat bubbles) with locked/generating state classes.
- `src/styles/app.css` — +655 lines of pure-CSS art riding the existing `--bys-*`/`--section-*` world tokens (aria-hidden, pointer-events none, clipped; **no 3D transforms** — Phase-E overflow lesson).
- `src/components/OrganizerLocked.tsx` (+5), `src/components/ActionCenterLocked.tsx` (+5), `src/components/CaseSummaryLocked.tsx` (+1) — locked variants echo the same motifs (compact tray / queue rows / dossier band).
- **5 files, +740/−1.** No new dependencies. P0 six files byte-identical (`git diff 746b670 d677df6 -- src/lib/analytics.ts src/lib/server-api.ts src/routes/login.tsx src/routes/pricing.tsx src/routes/consultations.tsx src/routes/trust.tsx` → **0 lines**).

## 2. Gates (all green)
| Gate | Command | Result |
|---|---|---|
| Build (Vercel output bundle) | `bash ./build-vercel.sh` | **PASS** (client + SSR + render.func assembled; `BUILD_EXIT=0`) |
| TypeScript | `bunx tsc --noEmit` | **PASS — 0 errors** (`TSC_EXIT=0`) |
| SSR hygiene | `bun run check:ssr` | **PASS — 14 routes SSR-clean, no recovery markers** |
| Track-B payment durability | `bun /home/team/shared/track-b/run-tests.ts` | **PASS — 67/67** (full run, real Neon, synthetic sessions; see /home/team/shared/track-b/run-tests.ts + EVIDENCE.md) |
| Mechanical responsive matrix | 8 widths × tools/timeline/review (CDP gate) | **PASS** — see §4 |

Note on build: the first `build-vercel.sh` attempt was SIGKILLed (OOM) because the previous session's headless Chrome + screenshot harness were still resident. Killed the stale Chrome tree, dropped page cache, retried → clean PASS. No code change involved.

## 3. Clean preview (NOT production) — exact SHA provenance
- Deployed with `bunx vercel@latest deploy --prebuilt` (no `--prod`) from the local build of the corrective, with meta pinned to the corrective SHA.
- **Preview URL:** https://site-ced1m90s0-hayden-8284s-projects.vercel.app
- **Deployment id:** `dpl_AoHknmJaRo54j3CDEqG96iGH1cjw`
- Vercel API (`/v6/deployments`, team hayden-8284s-projects):
  - `readyState` = **READY**
  - `target` = **null** (preview; production untouched — domains still serve `d8f7d22`)
  - `meta.githubCommitSha` = **`d677df669d761d72482056b73811ee1dd0f35176`**
  - `meta.githubCommitRef` = **`feat/mwo-tools-redesign`**
- Content proof: deployed `assets/index-x7D9E9B7.js` sha256 `fdc764859c55b9a10d16354f5510787e6b51f8ef75966f964ac27a4c500a70fc` == local `.vercel/output/static/assets/index-x7D9E9B7.js` sha256 (byte-identical bundle). `/home` SSR 200.
- Transparent note: branch HEAD at deploy time was `ee7cbf9` (the docs commit above, which adds ONLY PNGs under `docs/`); the docs commit does not touch the app bundle, so the deployed app is exactly the corrective d677df6 build. Meta was pinned to d677df6 via `--meta githubCommitSha=…` so the preview's provenance points at the corrective SHA the HOLD asked for.

## 4. Mechanical check — 8-width CDP gate (tools / timeline / review)
Harness: `/tmp/tools-shots2.mjs` (CDP, prefers-reduced-motion, gates installed per page; checks document overflow, horizontal bbox escape, unclipped overflow text, tap targets < 43.5px outside scrollers, overflow-x scrollers). Every width on every tab: `over=false`, `ctrl=0` (no overflowing controls), `bbox=0` (no elements escaping the viewport), `clip=0` (no clipped text), `tapsNotInScroller=0` (no undersized tap targets), `scr=0` (no horizontal scrollers).
- Tools hub: 320/375/390/393/430/768/1024/1440 — ALL CLEAN
- Timeline: 320/375/390/393/430/768/1024/1440 — ALL CLEAN
- Review (home): 320/375/390/393/430/768/1024/1440 — ALL CLEAN
(Full JSON: `/tmp/tools-gate2.json`.)

## 5. Screenshot inventory (raw.githubusercontent.com links)
All captured headless-Chrome against the preview URL above (exact corrective build). Repo: `hayden-glitch/beforeyousend`, branch `feat/mwo-tools-redesign`, path `docs/mwo-evidence/tools-redesign/`.

| File | Width | What it shows |
|---|---|---|
| tools-hub-390.png | 390 | Command Center foyer — full hub, mobile |
| tools-hub-393.png | 393 | Command Center foyer — full hub, 393 (iPhone 15/16 Pro edge) |
| tools-hub-1440.png | 1440 | Command Center foyer — full hub, desktop |
| organizer-390.png / organizer-1280.png | 390/1280 | Organizer desk (filing-desk + file tray) |
| case-summary-390.png / case-summary-1280.png | 390/1280 | Case Summary dossier (index-tab band + peeking sheets) |
| action-center-390.png / action-center-1280.png | 390/1280 | Action Center queue (priority rows + radar) |
| export-390.png / export-1280.png | 390/1280 | Export package (neutral print package — sheet fan + taped box) |
| attorney-prep-390.png / attorney-prep-1280.png | 390/1280 | Attorney Prep briefcase — UNLOCKED (clasp open, docket poking out) |
| attorney-prep-generating-390.png | 390 | Attorney Prep — generating state (busy button + case-generating) |
| attorney-prep-generated-390.png | 390 | Attorney Prep — after generation (notice + downloaded) |
| attorney-prep-locked-390.png / attorney-prep-locked-1280.png | 390/1280 | Attorney Prep — LOCKED (closed latch + keyholes, free tier) |
| record-review-390.png / record-review-1280.png | 390/1280 | Record Review audit lens (crosshair + fanned record stack) |
| record-review-generating-390.png | 390 | Record Review — "Reviewing your record…" busy state |
| record-review-report-390.png | 390 | Record Review — generated report panel |
| consultations-390.png / consultations-1280.png | 390/1280 | Consultations two-seat (speech bubbles + typing dots, full-width on sm+) |
| review-390.png | 390 | Review mode (paste-and-go home) |
| situation-390.png | 390 | Situation analyzer mode |
| saved-390.png | 390 | Saved history |
| log-390.png | 390 | Communication Log |
| timeline-320.png / timeline-375.png / timeline-390.png / timeline-393.png / timeline-430.png | 320–430 | Timeline 5-width sequence |
| tools-hub-free-390.png / tools-hub-free-1280.png | 390/1280 | Foyer as a free-tier dad sees it (all locked silhouettes in context) |
| organizer-locked-390.png / case-summary-locked-390.png / action-center-locked-390.png | 390 | Locked tab views (compact tray / dossier band / queue rows) |

**Raw URLs (branch feat/mwo-tools-redesign):**
```
https://raw.githubusercontent.com/hayden-glitch/beforeyousend/feat/mwo-tools-redesign/docs/mwo-evidence/tools-redesign/<file>
```
where `<file>` is each row above.

## 6. Tool silhouettes (one line each — for the handoff)
1. **Organizer** — filing-desk anchor: document stack with a waiting file in a tray (drawer strip on mobile, floating tray on sm+).
2. **Case Summary** — dossier/folio: index-tab band with peeking sheets and report lines; locked variant keeps the band motif.
3. **Action Center** — priority queue: stacked rows + radar beacon; locked variant shows compact queue rows.
4. **Export your record** — neutral print package: sheet fan + taped box (no Timeline ribbon).
5. **Attorney Prep Pack** — briefcase: latch, handle, keyholes; clasp opens and a docket pokes out when unlocked; pulse while generating; closed latch when locked.
6. **Record Review** — audit lens: crosshair over a fanned record stack with a scan line.
7. **Consultations** — warmer two-seat conversation: two speech bubbles with typing dots, spanning both grid columns on sm+.

## 7. Constraints honored
- No new dependencies (package.json untouched by d677df6).
- No P0 six-file changes (byte-identical vs parent).
- No payment/server/analytics logic touched (focused UI/design only, per HOLD).
- No 3D transforms in the new art (Phase-E overflow lesson).
- Production untouched: all four domains still serve `d8f7d22`; ads remain PAUSED per owner.
- Evidence directory committed and pushed on `feat/mwo-tools-redesign` (origin), working tree clean at end of Phase G.
