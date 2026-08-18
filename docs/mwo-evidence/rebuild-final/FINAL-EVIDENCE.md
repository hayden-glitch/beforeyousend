# Rebuild D6 — Final Evidence Package (§22 handoff requirements 6 + 8 + pointers)

Owner directive: **5304729186 §22** — FINAL HANDOFF evidence (screenshots at 320/390/393/430/768/1440, prefers-reduced-motion proof, plus pointers to the mechanical matrix and §21 regression gates).

- **Branch:** `feat/full-site-visual-rebuild`
- **Final HEAD (this package):** docs-only commits on top of 012dd35 (see git log); **app code final = 012dd35** (same app bytes as 37194fa). **No `src/` change was made in this evidence session** — the diff of `src/lib/analytics.ts` + `src/lib/server-api.ts` vs baseline `e6b977f` is **0 bytes**.
- **Screenshot + matrix target:** https://site-pa6lr8ktw-hayden-8284s-projects.vercel.app (dpl_DzXhhne6iDv9zTgZhVi3vNKcdzBD, READY, `target=null`, `meta.githubCommitSha=012dd35b…`). App bytes are identical to the final HEAD (docs do not affect the build), so these shots are honest for the final build.
- **Capture method:** raw-CDP headless Chrome (`chrome-151.0.7922.76`), normal-viewport captures (not iOS Full-Page composites — the owner's normal viewport is the source of truth), `Emulation.setDeviceMetricsOverride` per width, viewport height 900. Hero phases measured by polling `data-phase` on `.hero-state`. Authed surfaces captured with a freshly seeded simulated-paid QA session (ultimate tier, `qa-d6.paid@example.com`, fresh `qa-d7-*` session row, `/api/auth/me` confirmed `profile.tier = ultimate` before capture; row deleted after the run).

## Screenshot manifest (`shots/`) — 43 shots

All PNGs verified: PNG magic `89 50 4E 47 0D 0A 1A 0A` + size > 10 KB.

| File | Width | Surface | What it shows |
|------|-------|---------|---------------|
| `hero-before-320.png` | 320 | Homepage hero | **Panic.** phase (`data-phase="panic"` measured at capture) |
| `hero-before-390.png` | 390 | Homepage hero | **Panic.** phase (earlier D6 capture) |
| `hero-before-393.png` | 393 | Homepage hero | **Panic.** phase — measured `data-phase="strike"` (panic animation in progress: red strike drawn, calm word not yet shown) |
| `hero-before-430.png` | 430 | Homepage hero | **Panic.** phase — measured `data-phase="strike"` (same as above) |
| `hero-before-768.png` | 768 | Homepage hero | **Panic.** phase — measured phase=panic at capture |
| `hero-before-1440.png` | 1440 | Homepage hero | **Panic.** phase |
| `hero-after-320.png` | 320 | Homepage hero | Resolved calm word (`data-phase="calm"`) |
| `hero-after-390.png` | 390 | Homepage hero | Resolved calm word |
| `hero-after-393.png` | 393 | Homepage hero | Resolved calm word — measured `data-phase="calm"` |
| `hero-after-430.png` | 430 | Homepage hero | Resolved calm word — measured `data-phase="calm"` |
| `hero-after-768.png` | 768 | Homepage hero | Resolved calm word — measured phase=calm |
| `hero-after-1440.png` | 1440 | Homepage hero | Resolved calm word |
| `reduced-motion-390.png` | 390 | Homepage hero, `prefers-reduced-motion: reduce` | **Reduced-motion proof** — see note below |
| `pricing-320.png` | 320 | /pricing (mobile) | Pricing page, mobile plan stack (captured with the designed auto-modal visible at the bottom of the plan cards) |
| `pricing-390.png` | 390 | /pricing (mobile) | Pricing page, mobile plan stack (earlier D6 capture) |
| `pricing-393.png` | 393 | /pricing (mobile) | Pricing page — heading "Simple, honest pricing." DOM-verified |
| `pricing-430.png` | 430 | /pricing (mobile) | Pricing page — heading DOM-verified |
| `pricing-768.png` | 768 | /pricing (tablet) | Pricing page — heading DOM-verified |
| `pricing-1440.png` | 1440 | /pricing (desktop) | All four plans in one grid; heading DOM-verified |
| `review-320.png` | 320 | /home?tab=ai (authed, ultimate) | Review surface — "Your calm command center" h1 + "Paste the message you're about to send" label DOM-verified |
| `review-390.png` | 390 | /home?tab=ai (authed, ultimate) | Review surface (earlier D6 capture) |
| `review-393.png` | 393 | /home?tab=ai (authed, ultimate) | Review surface — DOM-verified |
| `review-430.png` | 430 | /home?tab=ai (authed, ultimate) | Review surface — DOM-verified |
| `review-768.png` | 768 | /home?tab=ai (authed, ultimate) | Review surface — DOM-verified |
| `review-1440.png` | 1440 | /home?tab=ai (authed, ultimate) | Review surface — DOM-verified |
| `timeline-320.png` | 320 | /home?tab=timeline (authed) | Event Timeline — h2 "Event Timeline" DOM-verified |
| `timeline-390.png` | 390 | /home?tab=timeline (authed) | Event Timeline (earlier D6 capture) |
| `timeline-393.png` | 393 | /home?tab=timeline (authed) | Event Timeline — DOM-verified |
| `timeline-430.png` | 430 | /home?tab=timeline (authed) | Event Timeline — DOM-verified |
| `timeline-768.png` | 768 | /home?tab=timeline (authed) | Event Timeline — DOM-verified |
| `timeline-1440.png` | 1440 | /home?tab=timeline (authed) | Event Timeline — DOM-verified |
| `organizer-320.png` | 320 | /home?tab=organizer (authed, ultimate) | The Organizer — "Your documents, in one calm place." DOM-verified |
| `organizer-390.png` | 390 | /home?tab=organizer (authed, ultimate) | The Organizer (earlier D6 capture) |
| `organizer-393.png` | 393 | /home?tab=organizer (authed, ultimate) | The Organizer — DOM-verified |
| `organizer-430.png` | 430 | /home?tab=organizer (authed, ultimate) | The Organizer — DOM-verified |
| `organizer-768.png` | 768 | /home?tab=organizer (authed, ultimate) | The Organizer — DOM-verified |
| `organizer-1440.png` | 1440 | /home?tab=organizer (authed, ultimate) | The Organizer — DOM-verified |
| `tools-320.png` | 320 | /home?tab=tools (authed, ultimate) | ToolsHub command list — `#tools` section DOM-verified (The Organizer "Live — in your plan", Case Summary, Action Center, Export, Attorney Prep Pack, Record Review, Consultations) |
| `tools-390.png` | 390 | /home?tab=tools (authed, ultimate) | ToolsHub (earlier D6 capture) |
| `tools-393.png` | 393 | /home?tab=tools (authed, ultimate) | ToolsHub — DOM-verified |
| `tools-430.png` | 430 | /home?tab=tools (authed, ultimate) | ToolsHub — DOM-verified |
| `tools-768.png` | 768 | /home?tab=tools (authed, ultimate) | ToolsHub — DOM-verified |
| `tools-1440.png` | 1440 | /home?tab=tools (authed, ultimate) | ToolsHub — DOM-verified |

(`dashboard-login-fallback-390.png` was **removed** in this update — it was superseded by the real authed shots and is no longer part of the manifest. No other files were deleted.)

### Width coverage vs §22 item 6 — COMPLETE
- **Hero (before+after Panic):** 320, 390, 393, 430, 768, 1440 — **all six widths.**
- **Review / Timeline / Organizer / Tools:** 320, 390, 393, 430, 768, 1440 — **all six widths** (authed, ultimate tier).
- **Pricing:** 320, 390, 393, 430, 768, 1440 — **all six widths.**
- Every §22 surface now has real screenshots at every required width; the mechanical matrix (below) covers the same widths plus 375/1024 for all routes.

## Reduced-motion proof (§22 item 8)

`reduced-motion-390.png` was captured with `Emulation.setEmulatedMedia prefers-reduced-motion: reduce`. Measured at capture time (live DOM):
- `.hero-state` `data-phase` = **`calm`** at ~1 ms after hydration (no panic wait, no strike, no timers — per `index.tsx` HeroState: `if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setPhase("calm"); return; }`).
- `.hero-strike` computed style: **opacity 0, width 0** (the red strike never draws).
- Re-checked at +400 ms: still `calm` (no late timers fire).
- The shot is a valid non-trivial render of the static resolved-calm state (91 KB).

## Pointer — mechanical QA matrix (§22 item 7) — NOW 100% CURRENT

**`../rebuild-d5a/matrix.jsonl`** (**67 rows**, all captured at final-build app code 012dd35, deduped by route+width, newest wins):
- Routes: consultations, faq, home, login, pricing, pricing|annual, privacy, terms, trust — widths 320/375/390/393/430/768/1024/1440.
- **ALL ROUTES CURRENT.** The previously-stale rows (consultations / trust / privacy / terms / faq) were re-probed at the final build (preview site-pa6lr8ktw, reduced-motion ON, same harness/probe as the 37194fa capture) and merged. Every row now reflects the final build.
- **consultations / trust / faq / home / login: 8/8 CLEAN** at every width — the d5b tap-target fix (footer FAQ link ≥44px on mobile) is confirmed; the old 31×44 footer-link flags are gone.
- **privacy (8 rows):** 2 small-target flags each — the inline prose links "support" and "email us" (61–68×19 px, `inline:true`) — **designed inline text links**, not defects.
- **terms (7 of 8 rows):** 1 flag — inline "Email us" prose link (68×19, `inline:true`); terms@430 is clean. Same designed-inline-link disposition.
- **pricing@320:** overlap entries + 2 bottom-bars = the **designed auto-modal overlay** (value-gated bottom sheet over the plan cards) — intended behavior, re-confirmed at final build. pricing@375–430: 1 bottom-bar each (same designed sheet), zero overlaps.
- **pricing@1440 / pricing|annual@1440:** FAQ footer link 31×44 — desktop-footer layout only (mobile widths are ≥44px); same designed-element disposition as the footer link.
- 0 horizontal scrollers, 0 clipped text, 0 overflow, 0 contrast failures, 0 error rows on any route.
- Summary files: `matrix-summary-final.txt` (new, all 67 rows — 22 flagged, all designed-element flags) and `matrix-summary-37194fa.txt` (kept as historical).

## Pointer — §21 regression gates (d5b)

**`../rebuild-d5b/gates-summary.md`** (final build 37194fa; unchanged — app code identical):
- **LIVE PASS:** a (Google recovery), b (dirty URL zero 3P pre-scrub), d (safe/unknown query bounds), e (login next capture-once), f (CTA→401→?next=), g (TikTok callback 404), j (checkout CTAs no-charge QA).
- **PASS w/ documented anomaly:** c — track() persists 1P and blocks 3P while dirty; jittery tag-load tail retries, not a leak.
- **CODE PASS:** h (account-delete log hygiene), i (row-scoped fulfillment), k (no duplicate events).
- **BUILD PASS:** l — `bun run build` + `npx tsc --noEmit` + `npm run check:ssr` green, Track-B 67/67.

## Known issues

1. **pricing@320 modal-backdrop overlap** (matrix row): designed auto-modal overlay over the plan card CTAs — intended behavior (value-gated modal at the bottom of the plans), not a defect. Re-confirmed at the final build; the same designed sheet accounts for the single bottom-bar entry at 375/390/393/430.
2. **Desktop footer FAQ link 31×44 at 1440** (pricing / pricing|annual rows): the shared footer link is below 44px wide only in the desktop footer layout; mobile widths are ≥44px after the d5b fix. Designed element, flagged for transparency only.
3. **Inline prose links on privacy/terms** ("support", "email us", 19px tall): designed inline text links inside legal copy; the harness flags them at every width. Not interactive buttons; no action taken (consistent with prior disposition).
4. **Orphan Stripe customer `cus_V52jZXQTvM9mXG`** (created during the paid-account transfer): harmless — no subscription, no charges, not attached to any app user; left in place deliberately.

## Honesty notes

- No CSS was injected to fake any state; every shot is the build's real render.
- Hero "before" shots at 393/430 were captured while the panic animation was mid-sequence (`data-phase="strike"` — red strike drawn, calm word not yet shown); 320/768 "before" shots were captured at `data-phase="panic"`. All "after" shots measured `calm`.
- The authed shots show the **empty-state** Command Center (fresh QA account, no log/timeline/files) — that is the honest surface for a new user.
- Matrix rows flag designed elements (modal overlay, inline prose links, desktop footer pill) with full transparency; no row hides a real defect.
- QA session rows (`qa-d7-*`) were inserted into `bys_auth_sessions` with 6 h expiry for capture and deleted after the run.
