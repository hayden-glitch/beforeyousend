# DECISION.md — Final Production-Candidate Rebuild: Design Direction

**Delegation:** D1 (design-first pass) of the 150% rebuild, per Codex spec comment 5306598020
(`/home/team/shared/codex-5306598020-final-rebuild-spec.md`, 29 sections).
**Branch:** `feat/final-prod-candidate` (descendant of live rollback point `708d8d8` — verified `git log`).
**Date:** 2026-08-16. **Scope:** design direction only — no `src/` changes, no deploy.
**Live rollback point unchanged:** `708d8d8` / `dpl_GwLb6eFnxCT9s67H5qxb2Jq4DM5x`.

---

## 0. What this document is

Three static high-fidelity comps were built, rendered at desktop 1440 and mobile 390, and
adjudicated against the spec's conversion thesis (§1). This document records the ONE chosen
direction, the honest comparison that produced it, and a per-section implementation directive
for the build delegations that follow (D2–D5). It is a working hypothesis for the team, not
an owner-ratified document.

### Deliverables produced by D1 (committed under `docs/final-candidate-comps/`)

| File | Purpose |
|---|---|
| `comp-a-workbench.html` | Direction A — light brand, composer-on-canvas, Command Center anchored **← CHOSEN** |
| `comp-b-midnight.html` | Direction B — dark studio, Ultimate anchored (counter-hypothesis) |
| `comp-c-decision.html` | Direction C — light editorial, plan-as-list, no recommended badge |
| `comps-shared.css` | Shared token/layout base all three comps link (extracted from A) |
| `comps-shot.mjs` | CDP capture harness (renders each comp × surface × viewport, logs active surface per shot) |
| `analyze-png.mjs` | Zero-dependency PNG signature/diff tool used to verify honest capture |
| `screenshots/` | 30 PNGs — 3 comps × (home panic/strike/calm + pricing + results) × (1440 + 390) |

The hero phase override (`#home&phase=panic|strike|calm`) is a **capture-harness control only** —
it is called out in the comp headers and must not survive into production code.

---

## 1. The three directions

### Direction A — "The Workbench" (light brand, composer-on-canvas, Command Center anchored)
- The homepage is a **single product scene**: lightweight header → Panic.→X→Calm. emotional state →
  one-line promise → **the working composer as the central plane of the page** (white surface on the
  cream canvas, hairline border, no floating marketing card) → `Review my message` → quiet trust line
  (`First review free · No account · Private` + `How privacy works` link) → `See plans` text action.
- Pricing: headline explains the choice in one line; three paid cards (Steady / Command Center / Ultimate)
  + Free as a de-emphasized reference line; **Command Center = Recommended** (broad-value anchor: reviews +
  organized record + tools, the differentiated BYS system); 3–4 distinguishing benefits visible per card,
  no "All benefits" wall; quiet monthly/annual toggle; one-time packs below as a separate section;
  comparison table farther down (not a tab); FAQ below the decision. Mobile sticky CTA is **neutral
  (`Choose a plan`)** until a meaningful selection.
- Results: answers in order **How might this land? → What could escalate? → What should I send instead?**;
  score is a quiet labeled stat (`Impact 46 · Heated · of 100 · tone signals only` — fixes the `46Heated`
  P2); one rewrite clearly **Recommended**, two alternatives visible but quieter; ONE dominant next step
  (save/continue) with upgrade framed as value already received.

### Direction B — "Midnight Command" (dark studio, Ultimate anchored)
- Same surfaces, flipped to the dark Midnight palette (deep green-black, bone type, forest-teal accent,
  vivid red X). Emotional register: the 11pm / low-light / high-stress moment.
- Deliberately anchors **Ultimate** as Recommended (the counter-hypothesis §12 asks us to evaluate).
- Results recommended rewrite gets a restrained **bronze** hairline instead of the forest badge.

### Direction C — "Decision Discipline" (light editorial, plan-as-list, no badge)
- Narrowest composition; composer flat against the hero (shadow-1 only).
- Pricing as a **single-column list** (one row per plan: name/job | price | visible benefits | CTA),
  **no Recommended badge at all** — steer by structure, not badges.
- Results: recommended rewrite **dominant** (larger, padded), alternatives collapsed behind a quiet
  `See 2 other ways to say it` disclosure.

---

## 2. Honest self-adjudication (vs §1 conversion thesis)

§1: a cold visitor must understand *what it is / why it matters / what to do / why trust* in 10 seconds
without reading a paragraph, and the homepage must feel like **the product itself**.

| Test | A — Workbench | B — Midnight | C — Decision |
|---|---|---|---|
| Product visible in first viewport (what to do) | **Strong** — composer IS the page | Strong — but dark first impression competes with comprehension | Strong |
| What it is / why it matters in 10s | **Strong** — "See how your message may land before you send it." + working composer | Good — emotional register is powerful but adds a beat to decode | Good |
| Why trust | **Strong** — trust line directly adjacent to the action (§3/§9) | Good | Good |
| Brand continuity with owner assets (forest/cream logo, OG, marketing) | **Highest** — same system, rebuilt | **Risk** — full-site dark flip changes public identity without owner sign-off; logotype/OG are light | High |
| Pricing decision clarity (§12) | **Strong** — 3 cards, one reasoned anchor, benefits visible | Good — dark cards, Ultimate anchor is pressure-adjacent | Good — but a list hides relative value at a glance and departs further from the "3 paid + free reference" structure the spec prescribes |
| Anchor honesty (§12: "do not assume Ultimate") | **Command Center** — broad value, defensible | Ultimate — tests the assumption, fails it | None — but a cold visitor gets no steer at all |
| Results conversion moment (§11) | **Strong** — recommended rewrite visible, alternatives available, one dominant next step | Good | Good — dominant rewrite, but hiding alternatives adds friction for the "show me my options" dad |
| Implementation risk / perf (§23) | **Lowest** — no theme flip, fewer novel surfaces | Medium — dark tokens must be AA-proven across every surface | Low |
| Owner calm/one-step philosophy | **Matches** — calm, one thing at a time | Matches, but heavier mood | Matches |

**Verdict: Direction A is chosen.** It implements the conversion thesis directly while holding the
owner's brand system (forest/cream — the logo, OG image, and marketing all live in that identity).
B's insights are not lost: the Midnight palette remains a **later** app-theme evolution (the existing
`data-theme="midnight"` token work), and its "serious private" register is retained in A via restrained
surfaces, narrow measures, and the red-X-only discipline. C's "one dominant next action" is already
baked into A's results surface. B's Ultimate anchor and C's no-badge list are recorded as the tested
alternatives and explicitly rejected: the first reads as pressure (§12), the second removes the steer
a cold visitor needs.

---

## 3. Per-section implementation directives

### §7 Visual system — accepted and encoded in A's shared CSS
- **No nested-card stacks.** The homepage has exactly one elevated plane (the composer workplane,
  `shadow-2`); below-the-fold narrative steps use `shadow-1` only.
- **Radii:** `--r-sm:8px; --r-md:10px; --r-lg:14px` — 14px reserved for the composer workplane and
  the next-step panel (optically needed), everything else 8–12px.
- **Spacing/surface/hairline before containers:** section rhythm, surface tone (`--card` vs `--bg`),
  and `--line` hairlines carry structure; containers only where a real boundary exists.
- **No pill rows unless a real segmented choice** — the Review/Analyze mode switch in the composer is
  the one true segmented control; Log topic chips are removed (see §16).
- **No folders/briefcases/devices/fake paper/dashboard-widget farms** anywhere in the comps; the
  product narrative uses real product data shapes (draft → calm line → ledger rows → summary export line).
- **Elevation levels:** exactly 3 — flat (canvas/`--bg`), raised (`--card` + `--shadow-1/2`), pop
  (modals/sheets `--shadow-3`). No glow.
- **Red only** for the Panic X, destructive actions, errors, and warnings; **bronze/steel** are not in A's
  palette (B tested bronze; not adopted for the light system).
- **Blurred-screenshot test:** A's composition is dominated by one centered working plane + narrow
  text column — proportion and hierarchy survive blurring.

### §6 Typography — sans-first, exact stack
- **Replaces `Fraunces` everywhere** (brand wordmark, hero, pricing names/prices, login, legal headings,
  final CTA): the product stack is
  `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
- **No Fraunces preload; no proprietary font bundling.** One font family; nothing is downloaded.
- **Calmer numerals:** `font-variant-numeric: tabular-nums` on all prices, scores, dates (§ pricing,
  score card, ledger rows).
- **Strong-not-theatrical hero weight:** 800 for the emotional state, 700 for H1s, tight tracking.
- **Serif only as a rare editorial accent:** the comp reserves `Georgia` italic for exactly one line on
  the landing final CTA ("The record you keep quietly is the one that speaks later."). If the lead/owner
  prefers zero serif, delete that one line — nothing else changes.

### Hero animation implementation approach (owner §4 timing)
- JS-driven timeline with CSS transitions, exact constants from §4:
  hold `Panic.` **2800ms** → stroke 1 **600ms** → pause **200ms** → stroke 2 **600ms** →
  hold crossed **900ms** → resolve **1500ms** → first calm word in; calm words rotate
  `Calm. Think. Breathe. Pause. Respond. Steady. Clear.` every **4000ms** with a **600ms** crossfade.
- **Two-stroke red X** as SVG `line` strokes with `stroke-dasharray`/`stroke-dashoffset` transitions
  (verified pattern; no layout shift — both words share one grid cell sized by the widest word).
- **Panic. may return rarely** (e.g., one in N loops) and every appearance must resolve through the X.
- **The animation never gates input** — it is a sibling of the composer, not a parent; typing and
  `Review my message` work from t=0.
- **Reduced motion:** `prefers-reduced-motion: reduce` → static resolved state instantly, no timers.
- **Screen readers:** the block is `aria-hidden`; a stable semantic phrase carries meaning (the H1
  region: "Before You Send — turns panic into a deliberate response." style, per live pattern).
- **Crayon lettering:** refined, adult — heavy weight, slight rotation, subtle texture via layered
  text-shadow in the comp; implementation may refine with a single small open-source WOFF2 (e.g.,
  Caveat/Kalam at a heavy weight) IF the lead approves a font download budget; otherwise the system
  heavy-weight treatment stands. **No proprietary/Apple fonts.**

### §5 Header / mobile identity — wordmark ALWAYS visible
- `Before You Send` brand (mark + wordmark) renders at **320/375/390/393/430** — never hidden below a
  breakpoint (current `SiteChrome` hides it below 480px; that rule is deleted).
- Header stays **lightweight**: transparent-to-blur hairline bar (no bordered toolbar), 58px tall,
  three items max on mobile: brand · Pricing · Sign in. No hamburger needed; the spec's "no menu just
  to solve spacing" is satisfied.
- Public nav stays tiny: brand (home), Pricing, Sign in/account.

### §8 Product demonstration — one connected narrative, not three cards
- The below-fold story is a **chain**: `message → better response → organized record → useful preparation`
  rendered as three distinct steps connected by arrows: a struck draft + calm rewrite (Review), three
  dated ledger rows (Record), a case-summary line with export affordance (Prepare).
- Product data creates the composition; no decorative illustration, no matching cards.

### §9 Trust at moments of doubt
- **Near composer:** `First review free · No account · Private` + `How privacy works` link, directly
  under the action. No large trust section on the landing.
- **After results / before capture:** the one next-step panel explains the account benefit ("Keep the
  calm version on your record — it takes a free account, no card") — never interrupts the payoff.
- **Pricing/checkout:** cancel mechanics and renewal cadence stated plainly on the pricing page
  (FAQ + card copy); no fake scarcity anywhere; privacy/not-legal-advice links available in context.
- **No invented testimonials/user counts/endorsements/outcome claims.** Product proof + transparency only.

### §10 Free-review conversion path
- Composer present on first viewport; paste → button immediately acknowledges; streaming state shows
  work (progressive reveal retained); first useful result (rewrites) before the ask; THEN one
  continuation ask. **One dominant next-step decision** after completion — no stacked funnels/promos/
  check-ins/quota prompts/upgrade cards at the same moment (the current capture card + lamp + special
  offer ordering must be audited in D4 so only one ask is visually dominant).

### §11 Results experience
- Order fixed: **How might this land? → What specifically could escalate? → What should I send instead?**
- Score is **secondary and labeled**: `Impact 46 · Heated · of 100 · tone signals only` — kills the
  `46Heated` and `Last message: 46` ambiguity (the label is explicit, separated by spacing, and the
  bar has an aria-label `46 out of 100`).
- **One rewrite recommended** (Gentle in the comp), Direct + Firm-but-neutral available beneath — never
  a wall of analysis.
- **Primary post-result action = next useful action** (copy/use/save/review another) per state;
  upgrade messaging comes after value.

### §12 Pricing — decision clarity
- Headline: "Choose how much of the system you need." — explains the choice in one line.
- Default view: **3 paid levels + free reference**, Free de-emphasized as a quiet line after the cards.
- **ONE recommended plan: Command Center** (broad value — reviews + organized record + tools).
- 3–4 distinguishing benefits visible per card without opening details; no `All benefits` hidden-required.
- Monthly/annual toggle kept, visually quiet (text buttons + `2 months free` chip).
- **One-time packs below memberships** as a separate compact section (they do not compete at the top).
- Comparison = a table **farther down**, not a top-level tab. FAQ below the decision.
- **Mobile sticky CTA is NOT hardwired to Ultimate**: neutral `Choose a plan` until a meaningful
  selection; implementation wires it to the selected/recommended plan only after selection, and it
  must not cover plan content.
- Job lines under each name: Steady = ongoing communication reviews; Command Center = reviews +
  organized record + tools; Ultimate = everything + consultation/packs.

### §13 Signup/login friction
- The `Three quick questions…` metadata and centered `One moment…` card are replaced: `/login` gets a
  quiet instant shell/skeleton (no loading-only surface), one field at a time, and **preserves context**:
  paid-plan CTA visitors continue checkout (plan carried, `?next=` return path preserved exactly —
  including the sensitive Stripe-return capture/scrub behavior, which is a §27 gate and must not regress).
- Free-review completers explain the account benefit before being asked; plain sign-ins skip onboarding.
- Funnel must feel continuous: homepage → results → pricing → account → Stripe.

### §15 Signed-in app IA
- Primary daily action: **Review**. Record-building: **Log / Timeline / Organizer**. Output: **Tools**.
  Account separate (UserMenu).
- Desktop: stable header + focused working plane (+ optional detail pane). Mobile: quiet safe-area-aware
  bottom nav, no keyboard occlusion, no hidden brand, state preserved on rotation/back/reload (existing
  behavior kept).

### §16 Communication Log
- **No wall of topic pills at first glance** — default is a clean chronological ledger (direction ·
  date · message preview · metadata), one compact search/filter control, topic filters exposed only
  when requested. Rows prioritize direction, date, preview, then metadata. Detail/edit/delete stays
  professional-record-like. (Current `TOPICS` chip row is removed from the default view.)

### §17 Timeline
- Chronology first; **no duplicate/ambiguous `All`** (the kind filter's `All` and the incidents
  category `All incidents` must not both read as the same thing — label the incidents filter
  `All incidents` explicitly). Four primary filters fit 320–430 **in a 2×2 grid** when needed, no
  nowrap tricks. Secondary category filters appear contextually. Selected record opens in a calm
  detail pane/sheet, not a layout explosion.

### §18 Organizer
- **No folder language in rendered UI.** Documents as rows/list/table with clear type/date/source/
  category; upload/add in one obvious place; filing suggestion secondary; detail drawer for metadata
  and actions; empty state says what to add and why (no illustration pile).
- Copy: `For [child]` / `Tag [child]` replaces `For [child]'s folder` everywhere (the Log edit form
  currently renders `For {child.name}'s folder` — delete the possessive in D4).

### §19 Tools
- Compact command/workspace **list** (Case Summary, Action Center, Export, Attorney Prep, Record
  Review) — each opens its real working surface. No giant icon tiles, no decorative legal props.

### §20 Content pages
- Trust/Privacy/Terms/FAQ/About/Contact/Consultation: restrained, narrow reading measure, obvious
  navigation back to value. FAQ may stay a clean question list (static is not a bug; friction is).
  Consultation: one clear offer, price, what happens, what it is not, primary booking action.
- **US 988 references removed** from trust copy unless the lead approves intentionally localized
  crisis-line text; none is approved in this pass.

### §21 Microcopy
- Labels describe the user's goal, not internal terminology; buttons = verb + outcome where ambiguous;
  remove repeated `calm/private/organized` once established; no decorative eyebrows on every screen;
  no fake urgency; neutral professional tone around family conflict. The comps' copy follows this
  (e.g., `Review my message`, `Choose a plan`, `See 2 other ways to say it`).

### §22 Interaction quality
- Pressed/selected state within one frame (`:active` scale + instant background change — the comps'
  `.btn:active{transform:scale(.985)}` pattern); network work gets immediate progress ack; ordinary
  transitions 150–250ms (comps use 150–200ms); drawers/modals get focus behavior + Escape/backdrop
  close (existing sheet patterns kept); no jumpy content shifts; no spinner when skeleton/progressive
  content works; rapid repeat clicks cannot create duplicate work/checkout (existing submit guards kept).

### §23 Performance plan
- Targets: Lighthouse mobile ≥90 (target ≥95), desktop ≥95, A11y ≥95 (target 100), LCP <2.5s (target
  <2.0s), CLS <0.10 (target <0.05), TBT <200ms (target <100ms), no broken resources, no oversized
  raster media, no continuously animated blur/filter/shadow.
- **Route-level splitting for signed-in heavy tools** (Organizer/SortMyPile/CaseSummary/ActionCenter
  already lazy — keep; verify OrganizerTrial chunk).
- **Homepage must NOT eagerly import product modules it doesn't need** — audit the initial chunk graph;
  the spec flags `TomorrowDraftsList` on the anonymous landing path (it is imported via `ReviewTool`;
  move the drafts list behind an auth-gated conditional import or a separate chunk so anonymous first
  paint excludes it).
- One font family, minimal preload, hashed immutable assets (existing).

### §24 Instrumentation
- Keep the minimum funnel (landing view, composer engagement, review started/completed, value action,
  signup started/completed, pricing viewed, plan selected, checkout started, purchase completed).
- **Clean up dead hero A/B/C runtime branching**: the rendered hero no longer differs (single brand +
  Panic state). Remove the head-script variant assignment and `data-hero-variant` branching ONLY after
  confirming the analytics events (hero_view/hero_cta_click) are either dropped or fixed to a constant;
  preserve historical event compatibility. Same audit for `bys_capture_variant` if the capture ask is
  unified. Do not redesign analytics/security logic beyond that.

### §25 Accessibility
- 44px touch targets (all primary controls are ≥44px in the comps), visible keyboard focus
  (`:focus-visible` accent outline), 200% zoom usable, reduced motion across the product, no color-only
  state (score chip is text + number + bar with aria-label), semantic headings, stable accessible hero
  phrase, form errors next to controls and in live regions, AA contrast on the light system (existing
  token contrast verified in the redesign spec).

### §27 Gates — list of accepted nonvisual gates + how the new design avoids touching them
Each of these is preserved as-is unless a delegation explicitly discloses and re-proves a change:
1. **Sensitive dirty-URL third-party block** — no change; header/footer/route changes don't touch it.
2. **Clean Google hydration recovery** — untouched.
3. **SAFE_UI key+value validation** — untouched.
4. **Login `next` capture/scrub/hard-navigation** — §13 changes are limited to the loading shell and
   copy; the capture/scrub/hard-nav mechanics are preserved exactly. **If login.tsx must change more
   deeply, disclose the diff and re-prove.**
5. **Pricing/consultation return capture before scrub** — preserved exactly (pricing layout changes do
   not alter `returnRef` capture or the scrub ordering).
6. **TikTok callback disabled/404** — untouched.
7. **Account-delete redacted logging + subscription safety** — untouched.
8. **Track-B row-scoped fulfillment; no runtime whole-table user writer** — untouched (no storage.ts
   changes in this pass).
9. **Working paid checkout CTAs in no-charge QA** — pricing CTA wiring must stay functional through the
   rebuild; D3 verifies checkout initiation without charging.
10. **Duplicate purchase/signup-event protections** — untouched.
- **Explicit statement:** the P0/payment files (`src/lib/api.ts`, `src/lib/offer.ts`, `src/lib/analytics.ts`,
  `src/lib/storage.ts`, checkout/confirm routes, auth routes) are **NOT** in scope for D2–D5 unless a
  delegation discovers a necessary change — in which case that change is disclosed in the delegation
  report with re-proof of every related gate before it proceeds.

### §28 What-not-to-do — acknowledged
No production deploy during this pass (none made); no Ads changes; no real charges; no fabricated
testimonials/metrics; no conversion-guarantee claims; no folders/briefcases/device mockups/illustration
piles; no extra copy to feel "complete"; no design-by-committee patchwork (one direction adopted);
no partial visual handoffs (each delegation delivers its full surface set + verification); the
100-session red-team happens only after the finished candidate.

---

## 4. Phased implementation plan (D2–D5)

Each delegation: branch off `feat/final-prod-candidate`, implement, run build + tsc + SSR + the
listed verification, commit + push. Deployments remain PREVIEW-ONLY (`--prod` is forbidden during
this pass). No delegation touches `src/lib/` payment/analytics/auth unless explicitly disclosed.

### D2 — Homepage + hero + header + type system
- **Scope:** `index.tsx` homepage rebuild (single product scene, composer above the fold with
  `ReviewTool` restyled as the working plane), `SiteChrome.tsx` (wordmark always visible at
  320–430; lightweight header), hero animation (exact §4 timing, two-stroke X, reduced-motion static,
  aria-hidden + stable phrase), typography flip (Fraunces → system stack, tabular numerals), CSS tokens
  (radii/shadows/hairlines per §7), footer/narrative chain (§8), trust line (§9), dead hero A/B cleanup
  (§24) with analytics-preservation check.
- **Verification:** 320/375/390/393/430/768/1024/1440 screenshots of home first viewport incl. Panic,
  X, resolved; composer functional (paste → button → streaming) in local QA; Lighthouse mobile pass
  recorded; no `TomorrowDraftsList` in the anonymous initial chunk (verify via build output/network).

### D3 — Pricing + signup/login funnel
- **Scope:** `pricing.tsx` rebuild (one-line headline, 3+free, Command Center recommended, visible
  benefits, quiet toggle, one-time section below, comparison + FAQ below, neutral mobile sticky CTA
  until selection, plan-selected reflection), `login.tsx` (quiet instant shell, one-field flow,
  context-preserving `?next=`, no `One moment…` card), onboarding/confirm polish, checkout-CTA wiring
  preserved and verified.
- **Verification:** pricing screenshots at 390/1440 (desktop + mobile sticky CTA states: neutral and
  selected); checkout initiation works in no-charge QA for a membership and a one-time pack; login
  round-trip preserves `?next=` and Stripe-return capture (re-prove §27 gates 4/5); build + tsc + SSR.

### D4 — Results + signed-in app surfaces
- **Scope:** `ReviewResults.tsx` (answer order, labeled score fixing `46Heated`/`Last message: 46`,
  one recommended rewrite, ONE dominant next step, upgrade-after-value), `ReviewTool.tsx` (composer
  restyle, drafts-list chunk isolation), `home.tsx` dashboard (IA per §15), Log (§16), Timeline (§17),
  Organizer (§18 — `For [child]` copy), Tools hub as compact command list (§19), TabBar/nav polish,
  capture-card/special-offer audit so only one post-completion ask is dominant (§10).
- **Verification:** authenticated QA at 390/1440 across every tab + Organizer trial + locked states;
  quota/402 path intact; copy sweep (§21); a11y pass; existing track() events preserved (or disclosed
  changes with analytics check).

### D5 — Performance + handoff evidence
- **Scope:** chunk/splitting audit (homepage initial graph, lazy tool chunks), preload/font cleanup,
  CLS/LCP passes, full Lighthouse matrix (mobile + desktop), viewport completion matrix (§26),
  build + tsc + SSR, screenshot package per §29, branch + SHA + preview deployment (exact-SHA,
  `target=null`), full §27 gate re-probe, **known issues list** (must be empty to claim
  PRODUCTION-READY; otherwise list them), confirmation Production/Ads/charges untouched.

---

## 5. Spec ambiguities needing clarification before D2

1. **Crayon lettering fidelity** — §4 asks for "refined readable white crayon/grease-pencil lettering."
   The comp approximates with heavy-weight system sans + subtle texture. A truly hand-drawn feel needs
   either a small open-source WOFF2 (font download budget conflicts slightly with §23's "minimal
   preload" preference) or an inline SVG text treatment. **Ask:** is the heavy-system treatment
   acceptable, or should D2 invest in a small self-hosted handwritten font?
2. **Hero word rotation** — §4 says "Panic. may return rarely." The comp rotates only the calm words
   and never returns Panic after resolve. **Ask:** should Panic re-enter the cycle (e.g., every 5th
   rotation) as owner direction implies, or is calm-only acceptable for a calmer product feel?
3. **Midnight theme** — B's dark direction was rejected for the public site, but the existing
   `data-theme="midnight"` theme work remains for the app. **Ask:** should the app Command Center
   keep the light theme in this pass (recommended) with Midnight as a later opt-in, or is a dark app
   theme desired before the red-team?
4. **Serif accent** — §6 permits "rare editorial accent." A uses one italic Georgia line on the
   landing final CTA. **Ask:** keep, or zero-serif for a strictly product feel?
5. **`TomorrowDraftsList` on landing** — the spec says the live homepage module-preloads it; in the
   current source it arrives via `ReviewTool.tsx`'s import. D2 will move it behind the authed gate,
   but if the lead knows the intended post-login placement differs, flag it before D2.

---

*End of DECISION.md — D1 complete. Next: D2 (homepage+hero+header+type), branch `feat/final-prod-candidate`, preview-only.*
