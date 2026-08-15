# PHASE-J — P2 tap-target fix evidence (`.room-chip` 44px) — SHA 96f0fc8

## 1. Provenance
- Branch: `feat/mwo-tools-redesign`, commit `96f0fc80a03d5d12989e3331fa1362743d9ff0e0` ("fix(tools): room-footer chips 44px tap target (P2 mechanical QA)"), parent `d50b18c` (3f53366).
- Code SHA (deploy meta): `96f0fc80a03d` = `git rev-parse HEAD` at build/deploy time.
- Preview: https://site-6lo3j31jt-hayden-8284s-projects.vercel.app — `dpl_3WefvcU7KpPFQfc5PG5t2dJAgnP4` — `readyState=READY`, `target=null`, `meta.githubCommitSha=96f0fc80a03d5d12989e3331fa1362743d9ff0e0` (verified via `GET /v6/deployments`).
- Production `d8f7d22` untouched; no `--prod`, no re-alias; ads remain PAUSED.

## 2. The fix (exactly one line, app.css only)
`src/styles/app.css` — `.room-chip`:
```diff
-  height: 38px;
+  min-height: 44px;
```
Label stays vertically centered (`align-items: center` on the inline-flex chip). Footer is in-flow below the floor band on mobile; `position:absolute; bottom:0` inside the 640px scene at ≥900px. No other rule touched.

## 3. Gates
| Gate | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `bash ./build-vercel.sh` | exit 0, `.vercel/output ready` |
| P0 six files vs `e6b977f` (`analytics.ts server-api.ts login.tsx pricing.tsx consultations.tsx trust.tsx`) | 0-line diff |
| `git diff --stat` (working tree vs HEAD) | 1 file changed (app.css), 1 insertion / 1 deletion |
| Deploy | READY / target=null / meta==HEAD |

## 4. Mechanical probes (raw CDP, QA sessions, real render of the preview)
### (a) `.room-chip` height — Log → / Timeline →
| Width | ultimate | free |
|---|---|---|
| 320 | 44 / 44 px | 44 / 44 px |
| 390 | 44 / 44 px | 44 / 44 px |
| 430 | 44 / 44 px | 44 / 44 px |
| 1440 (desktop) | 44 / 44 px | — |

Computed `min-height: 44px` confirmed on both chips at every width. (Pre-fix: 38px at every viewport, both tiers.)

### (b) Overflow / occlusion
- `document.documentElement.scrollWidth === clientWidth` (**no horizontal scroll**) at 320, 390, 430, 1440 — both tiers.
- Chip text `scrollWidth > clientWidth` = false (no label clip).
- Worst-case bottom-scroll nav occlusion (chips measured with the page scrolled to bottom, nav `fixed bottom-0`): `#tools` section bottom vs fixed nav top — 440<495 @320, 716<771 @390, 804<859 @430 — footer chips clear the bottom nav by ≥55px at every mobile width, both tiers.

### (c) 390 density + CTA
- Tools visible in first viewport at 390: **5** (desk, folio, console, tray, brief) — target ≥3 PASS. (320: 3; 430: 7.)
- Primary CTA count `#tools .cta-primary`: **exactly 1** — both tiers.

### (d) Desktop 1440 — six objects + right-third ink
- All seven objects render with rect > 0 (getBoundingClientRect): desk-organizer 640×310, folio 280×207, console 320×178, tray 270×192, brief 210×195, bench 250×286, seats 250×182.
- Grayscale render `tools-hub-gs-1440.png` (html filter proven `grayscale(1)`): dims 1448×828, density 6.2%, **hThirds L/C/R = 16/54/30 — right-third ink 30%** (same bar as v3 PASS; pre-fix desktop hid the objects entirely at 0%).
- No horizontal scroll at 1440.

## 5. Screenshot manifest
- `tools-hub-390.png` (555,407 B) — 390 viewport, room top, ultimate.
- `tools-hub-390-scroll2.png` (319,013 B) — 390, scrolled +844.
- `tools-hub-1440.png` (209,094 B) — 1440 room clip, ultimate.
- `tools-hub-gs-1440.png` (157,885 B) — 1440 grayscale (right-third ink audit).
- `capture-log.jsonl` — full probe records (10 rows + shots).

Raw: https://raw.githubusercontent.com/hayden-glitch/beforeyousend/feat/mwo-tools-redesign/docs/mwo-evidence/mwo2-chip-44px/

## 6. Verdict
**PASS.** The single P2 tap-target failure (38px → 44px) is fixed at every viewport and tier; the 6px bump introduced no new overflow, clip, occlusion, density, or desktop-scene regressions. Mechanical matrix otherwise unchanged from v3 (which was 8/8 PASS on everything else). This is the final fix before the MASTER PUBLISH-READY HANDOFF.
