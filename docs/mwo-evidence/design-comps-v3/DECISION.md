# DECISION.md — Design-first pass: Command Center / Tools hub direction

**Date:** 2026-08-15 · **Author:** full-stack engineer (design adjudication delegation)
**Comps:** `/home/team/shared/track-b/master-wo/design-comps-v3/{a,b,c}/` (index.html + mobile-390.png + desktop-1440.png + mobile-390-silhouette.png + desktop-1440-silhouette.png — all verified in place, real renders 43KB–586KB, 2026-08-15 22:11)
**Acceptance bar:** CODEX-REJECT-5304133183.md + CODEX-MWO-5304401127.md (see §0).
**This file is the contract for the implementation delegation.** The implementer builds from this spec and does not re-derive the design.

---

## §0 Acceptance bar (verbatim summary of the governing criteria)

1. Mobile density: several tools per 844px viewport; no giant empty halves; no one-tool-per-screen.
2. ONE primary CTA max on mobile; other tools get compact secondary/text-link actions.
3. Status integrated per metaphor — not a repeated pill on every tool.
4. Silhouettes/composition distinguishable in grayscale with text/art removed.
5. Desktop 1440 = deliberate command-center composition (a foyer/workbench), NOT a card grid enlarged from mobile.
6. Premium / calm / one-of-a-kind; one BYS brand, multiple memorable product worlds.
7. Implementable with real data hooks (fetchActionCenter / fetchCaseSummary), world tokens, locked states (Attorney Prep $24.50, Record Review $29.50, "See Command Center →").

---

## §1 Verdicts (verbatim)

### Direction A — The Ledger (restrained / editorial premium): **PARTIAL**
Editorial ledger is the calmest and densest read (6 tools in the first 844px: one hero desk + five index rows, exactly one primary CTA, premium serif, statuses as a ledger status column rather than pills), but the six index rows are silhouette-identical in grayscale (38 ink px/row — the tray block and CTA are the only structural moments; per-tool identity is carried by text + swatch tone, not shape) and desktop is a magazine spread, not the varied foyer of differently shaped surfaces the rejection demands — it solves trust and calm, not composition.

### Direction B — The Room (spatial / room-based): **PASS**
Every tool is a genuinely different surface whose art is structural (desk with file tray + legs; tabbed folio with gold ribbon; queue console with lit LED; export tray with stacked sheets; latched briefcase; lens bench; two-chair consultation room), objectively the densest silhouette set (94 ink px/row vs A's 38, C's 10), statuses live inside each metaphor (gold LIVE, LED + N TO DO, READY, price chips, ● NOW), exactly one primary CTA, and desktop is a real wall-and-floor foyer with objects at varied sizes and positions — the only direction whose composition alone carries the page with text removed, and the only one that maps 1:1 to the world-token architecture ("multiple memorable product worlds").

### Direction C — The Deck (utility / workbench): **FAIL**
Densest grid (6–7 compact panels per 844px) and the easiest to build, but with text/art removed the page is nearly blank (10 ink px/row in silhouette — least ink of the three; panels are thin uniform strips), it reuses the same small-caps status chip grammar on every panel, and desktop is a 250px rail + 3-column grid of identical rounded panels — precisely the rejected grammar (repeated card rectangles; "template dashboard" the owner explicitly ruled out).

---

## §2 Pick: **B — The Room**

**Rationale:** B is the only direction that satisfies the rejection's core demand — each tool is a different surface and the page is recognizable from composition alone (measured: silhouette ink 94 px/row vs 38/10; desktop is a real room scene, not a grid) — and it maps 1:1 onto the world-token architecture and the owner's "multiple memorable product worlds" bar.
**Risk (stated honestly):** the room conceit must be executed with restraint or it reads whimsical, not premium; A is the fallback if the owner's eye-test rejects B, and §7 defines the A-hybrid (per-tool silhouette art inside the ledger) rather than a rebuild.

---

## §3 Implementation spec — Direction B, "The Room" (Command Center hub)

### 3.1 Canvas + brand tokens
- Palette (BYS forest/cream, existing tokens): `--bg:#faf7f1` `--bg-soft:#f3ede2` `--card:#fffdf8` `--ink:#26221c` `--muted:#6f6a5e` `--line:#e6dfd2` `--forest:#1e4236` `--forest-deep:#16332a` `--forest-soft:#2e5a4b`.
- Type: Fraunces serif for all tool titles + status numerals; system sans for kicker/copy/meta/actions/rail headers. Tabular numerals (`font-variant-numeric:tabular-nums`).
- World tokens (per MWO ONE-BRAND-MULTIPLE-WORLDS layer): `world-desk` (Organizer) · `world-dossier` (Case Summary) · `world-action` (Action Center) · `world-export` (Export) · `world-briefcase` (Attorney Prep) · `world-audit` (Record Review) · `world-human` (Consultations). Each object root carries its token class; per-tool statuses/locked grammar hang off the token class.

### 3.2 MOBILE 390×844 (single-column room, top → bottom)
1. **Appbar — 56px.** Brand: BYS three-dot mark + "Before You Send / COMMAND CENTER" wordmark (Fraunces 16px + 9.5px letterspaced small). Right: avatar (30px circle, forest, initial).
2. **Room header — padding 22px 20px 0.** Kicker "COMMAND CENTER" (10.5px, letter-spacing .26em, muted, 600). H1 "Your case has a home." (Fraunces 26px, w560, lh 1.12). Lede "Each tool is a place — everything you save stays where you put it." (12.5px, muted, lh 1.45, max-width 34em).
3. **Room background:** `radial-gradient(120% 60% at 20% 0%, rgba(232,207,154,.34), transparent 60%)` + `radial-gradient(90% 50% at 85% 4%, rgba(188,220,234,.26), transparent 62%)` over `linear-gradient(180deg,#faf7f1,#f6f0e2 74%,#efe7d4)`.
4. **THE DESK — Organizer (featured anchor, the ONLY primary CTA on mobile).** margin-top 20; radius `6px 6px 18px 18px`; `linear-gradient(180deg,#f2e8cc,#e9dcb6)`; shadow `0 18px 34px rgba(88,70,30,.22)` + inset top highlight. Contents (padding 16px 16px 10px):
   - File tray: 4 files, 74×34, `#fffdf4→#f4ead2`, 1px `#d9c48e`, tab `i` 11px above top edge — colors: forest `#1a5c4d`, amber `#8a5a13`, blue `#2f4f78`, brown `#7a4a12`; line across each.
   - Head row: h2 "The Organizer" (Fraunces 21px w580) + tag "12 files · 3 folders" (10.5px w700, `#6b5d3c`, bg `#faf4e2`, border `#dccfae`, radius 6, padding 3px 8px).
   - Copy: "Every message, screenshot, bill and record — filed the moment you drop it in." (12px, `#6f6040`, lh 1.45).
   - **Note bar (the single mobile primary):** bg `#fdfaf0`, border `#ddd0ae`, radius 12, padding 10px 12px, shadow `0 6px 14px rgba(88,70,30,.14)`; left: "Your filing desk" (12.5px bold `#6b5d3c`) + "In your plan" (10.5px `#8d7c52`); right: **`.cta-primary` "Open the desk →" — 44px tall, forest `#1e4236`, `#f7f2e6`, w650, 13.5px, radius 12, shadow `0 8px 16px rgba(30,66,54,.30)`.** This is the ONE `.cta-primary` on the page (mobile AND desktop).
   - Legs: 3 × 10×16, `#cbb88b`, under the desk (aria-hidden).
5. **Shelf rows (grid `1fr 1fr`, gap 12, margin-top 14).** Each `.obj`: radius 14, overflow hidden, shadow `0 8px 20px rgba(50,42,26,.14)`, min-height **178px**, inner padding 12px 13px, flex column; h3 Fraunces 15.5px w590; `.o-sub` 10.5px lh 1.35; `.o-act` bottom (margin-top auto, 12px w700); `.o-state` 10px w700 letterspaced .05em.
   - **SHELF 1:**
     - **Folio — Case Summary** (`world-dossier`): surface `linear-gradient(160deg,#2c4a6e,#22395a 70%)`, border `#1a2d47`, text `#f4f1e6`; gold ribbon (20×34, `#d8b45c`) at right edge top; pager (bg `#fbf8ee` radius 8, 2 gray lines); counts chips `34 log · 12 events · 8 docs` (bg `rgba(255,255,255,.14)`, radius 6, 9.5px). Action "Open folio →" `#f4f1e6`; state **LIVE** in gold `#d8b45c`.
     - **Console — Action Center** (`world-action`): surface `linear-gradient(180deg,#fdf3dd,#f7e7c4)`, border `#e2c184`; dark rail header (bg `#7a4a12`, `#fdf3dd`, 12px uppercase w700) + LED (9px `#f0b35c`, glow ring); 2 queue rows (7px priority dots red `#a13a2f` / amber `#c98a2d` + 10.5px text `#5c470f`, dashed separators). Action "View queue →" `#7a4a12`; state **N TO DO** `#9a6b1e`.
   - **SHELF 2:**
     - **Tray — Export your record** (`world-export`): surface `linear-gradient(180deg,#f6f0da,#ede3c6)`, border `#d6c48e`; 3 stacked sheets (44px, `#fffdf6`, rotated ±2/1.5°, amber tape `#d8b45c` on top sheet). Action "Get the file →" `#5d4f1f`; state **READY** `#7c6a2e`.
     - **Briefcase — Attorney Prep** (`world-briefcase`): surface `linear-gradient(180deg,#6b1f2a,#541721 60%)`, border `#451019`, text `#f6ece2`; lid line + latch (22×12 `#c9a86a`); docket checklist (3 × 10.5px, empty square checkboxes `#c9a86a`); **price chip "One-time · $24.50"** (bg `#f3e6d6`, text `#541721`, 10.5px w700, radius 6). Action "See the pack →" `#f0d5a8`.
   - **SHELF 3:**
     - **Bench — Record Review** (`world-audit`): surface `linear-gradient(180deg,#eaf2f7,#dce9f2)`, border `#b9d0e0`, text `#12334d`; lens = 74px circle, 9px ring `#1e4a6e`, glass radial highlight; 2 strips "Log entries **34** / Timeline events **12**" (10.5px, dashed underlines, serif numerals). Action "Review my record →" `#1e4a6e`; state **$29.50** `#34678f`.
     - **Room — Consultations** (`world-human`): surface `linear-gradient(180deg,#f9e9e2,#f3d9cf)`, border `#e0b4a6`, text `#7e2f2a`; two chairs (52×46, `#b3544a→#a8443c`, "you" chair scaled 1.05) + speech bubble (64×30, `#fffdf6`, 3 dots). Action "Book a consult →" `#a8443c`; state **● NOW** with live dot `#3f7d4e`.
6. **Floor** — 34px, radius `12px 12px 0 0`, `linear-gradient(180deg,#ede3c9,#e5d8b8)`, top border `#dccfae`, margin-top 16.
7. **Foot** — 2 chips "Log →" "Timeline →" (38px pills, border `--line`, bg `--card`, forest 13px w600), gap 10, padding 14px 4px 8px.

### 3.3 DESKTOP 1440×900 (the room scene)
- Appbar 64px (padding 0 44). Room padding 30px 44px 0. Header h1 30px.
- **Scene** (height **640px**, margin-top 26): wall band (absolute, top 0, height 430, radius 24, `linear-gradient(180deg,#f4ecd9,#ece1c8)`, border `#e2d6b8`) + floor band (top 430, height 210, radius 24, `linear-gradient(180deg,#e7dbc0,#ddcfa9)`, border `#d3c49b`).
- Objects (absolute within scene):
  - **Console — Action Center:** right 56, top 40, width **320** (wall-mounted). Rail + 3 queue rows + "View full queue → **3 TO DO**".
  - **Desk — Organizer:** left 56, top 150, width **640**. Files 120×52; h2 26px; copy 13.5px; note + primary CTA 48px "Open the desk →"; legs.
  - **Folio — Case Summary:** right 70, bottom −16 (overlapping desk corner), width **280**; shadow `0 18px 34px rgba(30,50,80,.4)`; pager + counts.
  - **Tray — Export:** left 56, top 470, width **270**; sheets 50px.
  - **Briefcase — Attorney Prep:** right 420, top 430, width **210**, min-height 150.
  - **Bench — Record Review:** left 356, top 470, width **250**.
  - **Seats — Consultations:** right 56, top 470, width **250**; chairs 60×54, bubble 80×34.
- Foot: absolute bottom, left/right 44, padding 10px 0.
- **Not a grid**: seven surfaces, six distinct sizes (640 / 320 / 280 / 270 / 250 / 210 wide) at six distinct positions on wall/floor/desk — deliberate foyer.
- **Responsive reflow (mechanical matrix 320–1440 must pass):** ≥1100px use the absolute scene above; 900–1100px scale positions proportionally (left/right/top as % of scene); <900px collapse to the §3.2 mobile flow (desk → shelves → floor). Test every width in the 8-width matrix; no horizontal scroll; no overlap at 1024/1280.

### 3.4 CTA hierarchy (both breakpoints)
- **Exactly ONE `.cta-primary`**: the desk's "Open the desk →" (mobile 44px in the note bar; desktop 48px in the note). All other tools use compact `.o-act` text links. When the Organizer is locked for the user's tier, the same button relabels **"See Command Center →"** and routes to pricing/upgrade — still the one primary.
- No full-width CTAs on shelf objects. No CTA on the folio beyond its text link.

### 3.5 Status placement (per metaphor — no repeated pill)
- Case Summary → gold **LIVE** on navy folio (state slot bottom-right).
- Action Center → rail **LED** (amber pulsing when open) + **N TO DO** bottom-right.
- Export → **READY** (green-tinted text) bottom-right.
- Attorney Prep → **price chip "One-time · $24.50"** (always visible, purchasable one-time).
- Record Review → **$29.50** price text bottom-right.
- Consultations → **● NOW** green live dot.
- Organizer → plan tag "In your plan" (chip in desk head) — becomes "Part of Command Center" when locked.

### 3.6 Locked / unlocked / generating states (wire to existing tier + entitlement logic; do not change server behavior)
- **Free tier:** folio state → stamp "Part of Command Center" (replace LIVE); console → `.ac-locked` skeleton rows (3 muted dashed rows) + action link "See Command Center →"; tray → "See Command Center →"; brief → latch **closed** + price chip $24.50 (click opens the one-time purchase flow); bench → $29.50 (one-time purchase flow); seats always open ("Book a consult →" → consultations, $39.50); desk → note copy "Part of Command Center", primary CTA → "See Command Center →".
- **Steady tier:** per existing entitlements — desk/export/case/action gates follow current server logic (Command Center tier unlocks them); brief + bench remain one-time price chips; seats open.
- **Unlocked (Command Center/Ultimate):** folio LIVE gold; console LED lit + live queue rows; tray READY; brief **latch open (rotated)** + action "Generate the pack →" (402-gated server-side, per current code); bench "Review my record →"; desk "Open the desk →".
- **Generating (pack being built):** brief latch half-open + busy state on the action text (existing 402/queue behavior).

### 3.7 Real data hooks (no mock data in the build)
- `fetchCaseSummary()` → folio counts (log entries / timeline events / documents) → folio counts chips + bench strips + export file counts.
- `fetchActionCenter()` → queue rows (text + priority → dot color: red high / amber mid / blue info) + count → "N TO DO"; locked tier → skeleton rows.
- Organizer "12 files · 3 folders" → real organizer storage counts from the existing organizer data path.
- Consultations "● NOW" → real availability from the consultations path (existing `bys_consultations` record/availability).
- One-time prices $24.50 / $29.50 → server catalog constants (never hardcode a second copy).
- Tier/locked states → `userTier` + `profile` entitlements at request time (existing server-api tier read).

### 3.8 Typography plan (summary)
Fraunces: h1 26/30 · object titles 15.5/16–18 · count numerals 11.5–14 · status numerals. Sans: kicker 10.5 (.26em caps) · copy 10.5–12 · actions 12 w700 · rail 12 caps w700 · tags 10.5. All numerals tabular.

### 3.9 Spacing/density numbers (authoritative)
Mobile: room padding 22/20 · shelf gap 12 · object min-height 178 (≈¼ viewport, two per row → **5 tools in the first 844px** with the desk) · object padding 12/13 · desk padding 16 · note padding 10/12 · floor 34 · chips 38px · foot gap 10. Desktop: scene 640 tall · wall 430 · floor 210 · gaps between objects ≥ 16px; object widths 640/320/280/270/250/210.

### 3.10 Gate checklist for the implementer (unchanged from the MWO)
`bun run build` → `npx tsc --noEmit` (0) → `bun run check:ssr` → Track-B 67/67 → P0 six-file 0-diff vs `e6b977f` → mechanical responsive matrix 320–1440 (8 widths) → grayscale fingerprint (per-tool silhouette distinct: folio/console/tray/brief/bench/seats/desk) → viewport screenshots @390/1440 → single `MASTER PUBLISH-READY HANDOFF` post. Production `d8f7d22`, ads, Stripe: untouched.

---

## §4 Measured evidence (objective, from the rendered PNGs — 2× scale noted where applicable)

| Metric | A · Ledger | B · Room | C · Deck |
|---|---|---|---|
| Silhouette ink (avg px/row, mobile 390 sil) | 38 | **94** | 10 |
| Color ink (avg px/row, mobile) | 58 | **102** | 25 |
| Structural bands in first 844px (sil) | 8 (tray + CTA + 4 swatches) | 7 (desk parts + 2 shelf blocks) | 12 thin strips |
| Distinct tools in first 844px | ~6 (1 hero + 5 rows) | **5** (desk + 4 shelf objects) | 6–7 panels |
| `.cta-primary` count (mobile, from source) | 1 | **1** | 1 |
| Per-tool silhouette uniqueness | uniform rows (swatch tone only) | **unique per tool** (art structural) | uniform thin strips |
| Desktop 1440 composition | 2-col editorial + subband | **wall+floor room, 6 sizes/6 positions** | rail + 3-col uniform grid |
| Ink @1440 (avg px/row) | 37 | **79** | 28 |

Verdicts fall out of the criteria in §0: B passes the structural bar outright; A fails composition-as-foyer (#4/#5); C fails #4/#5/#6.

---

## §5 Artifact locations
- Comps + renders + silhouettes: `/home/team/shared/track-b/master-wo/design-comps-v3/{a,b,c}/` (5 files each, all present).
- This decision: `/home/team/shared/track-b/master-wo/design-comps-v3/DECISION.md` (+ copy committed to repo `docs/mwo-evidence/design-comps-v3/DECISION.md` on `feat/mwo-tools-redesign` for the handoff evidence package).
