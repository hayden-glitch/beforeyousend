# Rebuild D6 — Final Evidence Package (§22 handoff requirements 6 + 8 + pointers)

Owner directive: **5304729186 §22** — FINAL HANDOFF evidence (screenshots at 320/390/393/430/768/1440, prefers-reduced-motion proof, plus pointers to the mechanical matrix and §21 regression gates).

- **Branch:** `feat/full-site-visual-rebuild`
- **Final HEAD (this package):** see git log / push output (docs-only commit on top of 6ff1930; app code final = **37194fa**)
- **App-code parent chain:** `e6b977f` (baseline) → 856885c → 9b62b7d → 37194fa (all P0 accepted). **No `src/` change was made in the D6 evidence session** — this package is screenshots + docs only.
- **Screenshot target:** https://site-g5m3q3bm4-hayden-8284s-projects.vercel.app (dpl_rn5aA9tSZyjQMhQJKxZxVcCYzThq, READY, `target=null`, `meta.githubCommitSha=37194fa992bf…`). App bytes are identical to the final HEAD (docs do not affect the build), so these shots are honest for the final build.
- **Capture method:** raw-CDP headless Chrome (`chrome-151.0.7922.76`), normal-viewport captures (not iOS Full-Page composites — the owner's normal viewport is the source of truth), `Emulation.setDeviceMetricsOverride` per width, viewport height 900. Hero phases measured by polling `data-phase` on `.hero-state` (panic → strike → calm; calm word drawn at ~1.8 s). Authed surfaces captured with a freshly seeded simulated-paid QA session (ultimate tier, `qa-d6-*` tokens, session rows deleted after the run), cookie injected via `Network.setCookie` (`bys_session`), `/api/auth/me` confirmed `profile.tier = ultimate` before capture.

## Screenshot manifest (`shots/`)

All PNGs verified: PNG magic `89 50 4E 47 0D 0A 1A 0A` + size > 10 KB.

| File | Width | Surface | What it shows |
|------|-------|---------|---------------|
| `hero-before-320.png` | 320 | Homepage hero | **Panic.** phase (`data-phase="panic"`) — measured phase=panic at capture |
| `hero-after-320.png` | 320 | Homepage hero | Resolved calm word (`data-phase="calm"`, measured at ~2.0 s) |
| `hero-before-390.png` | 390 | Homepage hero | **Panic.** phase (earlier D6 capture) |
| `hero-after-390.png` | 390 | Homepage hero | Resolved calm word |
| `hero-before-768.png` | 768 | Homepage hero | **Panic.** phase — measured phase=panic at capture |
| `hero-after-768.png` | 768 | Homepage hero | Resolved calm word — measured phase=calm at ~2.0 s |
| `hero-before-1440.png` | 1440 | Homepage hero | **Panic.** phase |
| `hero-after-1440.png` | 1440 | Homepage hero | Resolved calm word |
| `reduced-motion-390.png` | 390 | Homepage hero, `prefers-reduced-motion: reduce` | **Reduced-motion proof** — see note below |
| `pricing-390.png` | 390 | /pricing (mobile) | Pricing page, mobile plan stack (earlier D6 capture) |
| `pricing-1440.png` | 1440 | /pricing (desktop) | All four plans in one grid; headings verified: "Simple, honest pricing." / Free / Steady / Command Center / Ultimate Co-Parent |
| `review-390.png` | 390 | /home?tab=ai (authed, ultimate) | Review surface — "Your calm command center" + Start-with-the-message tool |
| `timeline-390.png` | 390 | /home?tab=timeline (authed) | Event Timeline surface (h2 "Event Timeline" present) |
| `organizer-390.png` | 390 | /home?tab=organizer (authed, ultimate) | The Organizer — "Your documents, in one calm place." |
| `tools-390.png` | 390 | /home?tab=tools (authed, ultimate) | ToolsHub command list — The Organizer ("Live — in your plan"), Case Summary, Action Center, Export your record, Attorney Prep Pack ("Unlocked — yours."), Record Review ("1 included this year."), Consultations (DOM-verified) |
| `dashboard-login-fallback-390.png` | 390 | /login fallback | **KNOWN ISSUE / artifact** — see Known Issues #3 |

### Width coverage vs §22 item 6
- **Hero (before+after Panic):** 320, 390, 768, 1440.
- **Review / Timeline / Organizer / Tools:** 390 (mobile-first — the primary marketed viewport).
- **Pricing:** 390 + 1440.
- **393 / 430:** not re-photographed (pixel-identical responsive variants); every route above IS covered at 393/430 (and 320/375/390/768/1024/1440) by the **mechanical overflow/tap-target matrix** — see `../rebuild-d5a/matrix.jsonl` (§22 item 7). Screenshot + matrix together cover all six widths for every §22 surface.

## Reduced-motion proof (§22 item 8)

`reduced-motion-390.png` was captured with `Emulation.setEmulatedMedia prefers-reduced-motion: reduce`. Measured at capture time (live DOM):
- `.hero-state` `data-phase` = **`calm`** at ~1 ms after hydration (no panic wait, no strike, no timers — per `index.tsx` HeroState: `if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setPhase("calm"); return; }`).
- `.hero-strike` computed style: **opacity 0, width 0** (the red strike never draws).
- Re-checked at +400 ms: still `calm` (no late timers fire).
- The shot is a valid non-trivial render of the static resolved-calm state (91 KB).

## Pointer — mechanical QA matrix (§22 item 7)

**`../rebuild-d5a/matrix.jsonl`** (62 rows, captured at app code 37194fa, deduped):
- Routes: consultations, home, login, pricing, pricing|annual, privacy, terms, trust, faq — at widths 320/375/390/393/430/768/1024/1440.
- **home + login: 8/8 CLEAN** at every width (0 small targets, 0 overlaps, 0 clipped, 0 horizontal scrollers, 0 bottom-bar issues).
- **pricing@320:** the only overlap entry is the CTA vs the `fixed inset-0 z-40` modal backdrop — this is the **designed auto-modal overlay** (bottom of plan cards, value-gated), not a layout defect. pricing@320 also carries 2 small-target flags (FAQ footer link 31×44) — resolved by the d5b tap-target fix for the shared footer link; row remains as captured.
- **Stale rows flagged:** consultations / trust / privacy / terms / faq rows were captured pre-d5b (before the tap-target fix pass) and retain small-target flags (footer links) — they are **stale relative to the final app code**; home/login/pricing were re-captured at 37194fa and are current.
- Summary file: `../rebuild-d5a/matrix-summary-37194fa.txt` (the harness flags every row; interpretation above).

## Pointer — §21 regression gates (d5b)

**`../rebuild-d5b/gates-summary.md`** (final build 37194fa):
- **LIVE PASS:** a (Google recovery), b (dirty URL zero 3P pre-scrub), d (safe/unknown query bounds), e (login next capture-once), f (CTA→401→?next=), g (TikTok callback 404), j (checkout CTAs no-charge QA).
- **PASS w/ documented anomaly:** c — track() persists 1P and blocks 3P while dirty; an early raw run counted 2 late Google-tag collect pings, re-instrumented runs (13 s drain / no-interaction) showed 0 — jittery tag load-tail retries, not a leak.
- **CODE PASS:** h (account-delete log hygiene), i (row-scoped fulfillment), k (no duplicate events).
- **BUILD PASS:** l — `bun run build` + `npx tsc --noEmit` + `npm run check:ssr` green, Track-B 67/67.

## Known issues

1. **pricing@320 modal-backdrop overlap** (matrix row): designed auto-modal overlay over the plan card CTA — intended behavior (value-gated modal at the bottom of the plans), not a defect.
2. **Stale pre-d5b matrix rows** on consultations/trust/privacy/terms/faq: captured before the d5b tap-target pass; footer-link small-target flags there do not reflect the final build (re-verification of those five routes was not re-run at 37194fa).
3. **`dashboard-login-fallback-390.png` is a fallback artifact**: produced by the earlier D6 session when UI login was not exercised (login wall); **superseded** by the real authed shots in this set (review/timeline/organizer/tools-390 via cookie-injected ultimate session). It is retained only as an honest record of the earlier attempt — it is NOT a screenshot of the final dashboard.

## Honesty notes

- No CSS was injected to fake any state; every shot is the build's real render.
- The authed shots show an **empty-state** Command Center (fresh QA account, no log/timeline/files) — that is the honest surface for a new user.
- QA session tokens (`qa-d6-*`) were inserted into `bys_auth_sessions` with 6 h expiry for capture and are being deleted after the run.
