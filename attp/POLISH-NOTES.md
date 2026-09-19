# ATTP — About values scene (2026-07-30, later pass)

Replaces the standalone "Anatomia jocului" paddle-scroll section on `about.html`.

**Why it was changed.** It sat in a white product-photo card (`.paddle-frame-shell`,
`linear-gradient(145deg,#f1f2f3,#d9dde1)`) on a navy site, ran 430vh of scroll, and
said nothing about ATTP — decoration wedged between the values copy and the team
grids. Only the *card* was white; the three WebPs have always had alpha.

**What it is now.** The section *is* the Valori section — the old flat
`.values-row` was deleted and its three cards became the scroll steps:

| Layer | Value | Tag |
|---|---|---|
| wood | Respect | Miezul din lemn |
| red | Excelență | Fața de atac |
| black | Echipă | Fața de control |

Scroll 0→0.30 pulls the paddle apart; then three bands (0.26 / 0.52 / 0.78) each
raise one value to full opacity and dim the other two layers. Height 430vh → 340vh.

Design: no card, no border — layers sit on the page over a blurred teal backlight
plus an elliptical contact shadow. Section edges feather via gradient instead of
the old `border-block`.

Notes:
- Highlight uses the standalone `scale` property, not `transform`, so the CSS
  transition can't fight the per-frame `transform` the scroll writes.
- Black dims to `.5` rather than `.24` — it has no luminance to lose and would
  otherwise vanish rather than recede. It also carries a 1.5px light rim.
- Every step's text is in the static markup and each is a `<button>` that jumps
  to its band, so the content is reachable without scrolling or a mouse.
- ≤880px **and** reduced motion: `.is-static` — plain exploded diagram + list, no
  sticky, no 3× viewport of scroll. `will-change` is scoped away from that path.
- `data-no-reveal` on the section keeps `motion.js` from putting a reveal
  transform on the sticky element.

Revert: `git checkout attp/about.html` (tracked; not in `.polish-backup-20260730/`).

---

# ATTP — flow & polish pass (2026-07-30)

Goal: make the site read as one continuous page instead of stacked sections —
kill hard cutoff lines, add continuity of light and motion, modernise interaction
feel. Scope: `geezfully.com/attp` only. Nothing outside `attp/` was touched.

## How to revert

Full snapshot of every file that existed before this pass:

```bash
cd ~/geezfully/attp
cp .polish-backup-20260730/style.css css/style.css
cp .polish-backup-20260730/{privacy,news-article,player,gallery,contact}.html .
rm js/motion.js
# then remove the motion.js <script> tag from all 12 pages:
sed -i '' '/js\/motion\.js/d' *.html
```

`js/motion.js` is new (no backup needed — just delete it).
Individual changes can also be reverted one at a time using the list below.

---

## 1. Global CSS — `css/style.css`

### 1a. Removed hard section boundaries (the main complaint)

| Element | Before | After |
|---|---|---|
| `.topbar` | `border-bottom:1px solid var(--border)` — permanent hard line | Transparent border at rest; gains a soft border + feathered `::after` shadow only when scrolled (`.is-stuck`, set by `motion.js`) |
| `.page-head` | `border-bottom:1px solid var(--border)` — full-bleed hard cut under every interior page header | `::after` feathered rule that fades out at both edges |
| `footer` | `border-top:1px solid var(--border)`, `margin-top:60px` | Gradient lift-in (`transparent → rgba(9,22,37,.55) → rgba(8,20,34,.85)`), feathered `::before` rule, `margin-top:80px`, `padding` 56px→72px |

Left intentionally alone (these are legitimate *internal* list dividers, not
section cutoffs): `.score-row`, `.participant-row`, `.news-list-item`,
`.rule-item`, `.tourn-mini-row`, `.footer-bottom`, `table.data`, `.lightbox-head`.

### 1b. Continuity of light
- Added `body::before` — a **fixed**, viewport-anchored ambient wash (teal top-right,
  warm bottom-left, both very low alpha). The existing `body` gradients only paint
  once at the top of the document, so long pages went flat below the fold. This
  keeps the same depth of light all the way down. `z-index:-1`, `pointer-events:none`.

### 1c. New shared interior-page flow wrapper
- Added `.page-flow` — gradient (`#0a2340 → ink @640px`) + a soft radial highlight,
  the shared counterpart to the existing per-page `*-flow` classes on the hero pages.

### 1d. Motion / interaction polish
- `html`: added `scroll-padding-top:96px` so anchor jumps don't land under the sticky topbar.
- `html`: `scroll-behavior:smooth` now disabled under `prefers-reduced-motion:reduce`.
- `html`: thin themed scrollbar via `scrollbar-color` / `scrollbar-width` (feature-gated with `@supports`).
- `a`: added `transition:color .18s ease`.
- `.card`: was only a border-colour change on hover → now also lifts (`translateY(-2px)`),
  deepens shadow, and shifts to `--surface-2`. Lift disabled under reduced motion.

### 1e. Scroll-reveal styles (new)
- `.reveal` / `.reveal.is-in` — fade + 20px rise, `.72s` eased, with `--reveal-delay` for stagger.
- Wrapped in `@media (prefers-reduced-motion:no-preference)`.
- **Safety guard:** `html:not(.reveal-ready) .reveal{opacity:1;transform:none}` — if the
  JS never runs, nothing is ever hidden. `reveal-ready` is only added by JS once it
  knows it can drive the animation.

---

## 2. New file — `js/motion.js`

Two jobs:
1. **Sticky topbar state** — toggles `.is-stuck` past 8px of scroll (rAF-throttled, passive).
2. **Scroll reveal** — auto-tags the direct children of `main section` / `main .page-head`
   so no per-page markup edits were needed.

Design notes:
- **Deliberately does *not* use IntersectionObserver.** Verified during this pass that
  an IO callback can simply never fire in some contexts, which would strand content at
  `opacity:0` permanently. Instead it uses a rAF-throttled viewport sweep on
  scroll/resize, plus a `setInterval(900ms)` backstop, plus a `load` handler. With only
  ~1–16 tracked elements per page the cost is negligible. Listeners and the interval
  tear themselves down once everything has been revealed.
- The backstop only ever reveals what is **currently on screen**, so the effect is
  preserved for content further down the page.
- Skips: heroes (`[class*="hero"]` — they have their own entrance choreography),
  `#loadScreen`, `#mobileNav`, `aria-hidden="true"`, absolutely/fixed-positioned art,
  and anything marked `data-no-reveal`.
- Bails out entirely under `prefers-reduced-motion:reduce` (topbar state still applies).
- Tags *section containers'* children, never the async-rendered list items themselves,
  so it never races Supabase content arriving late.

**Escape hatch:** add `data-no-reveal` to any element to exclude it.

---

## 3. Per-page changes

- **`index.html`** — `.scoreboard-stage` had `border-top` *and* `border-bottom` 1px hard
  rules, the most visible seam on the homepage. Replaced with a layered background whose
  top layer feathers into the hero above (`#071421`) and the ink below, so the band melts
  into the page. No z-index/overlay used, so no risk of covering content.
- **`privacy.html`, `news-article.html`, `player.html`** — these three opened on flat ink
  with a bare `.page-head`, reading as a detached header + body. Their `<main>` contents are
  now wrapped in `<div class="page-flow">`. Content itself is unchanged (indent only).
- **All 12 pages** — added `<script src="js/motion.js?v=...">` before the load-screen script;
  bumped `style.css` cache version `20260730-mobilefix2` → `20260730-flow`.

---

## Verification performed

- All 12 pages: `motion.js` present, CSS version consistent, no console errors.
- Reveal contract proven end-to-end: below-fold element stays hidden → moved into the
  viewport → gains `is-in` + stagger delay. Also confirmed the `setInterval` backstop is
  what carries it when `requestAnimationFrame` never fires.
- Confirmed `.topbar` / `.page-head` computed borders are now `0px`.
- No horizontal overflow at 375px on the restructured pages (player, news-article, privacy)
  or at desktop widths.
- Article body still renders on `news-article.html` after the wrapper change.

### Known environment caveat (not a site bug)
The in-app browser pane reports `visibilityState:'hidden'` and never fires
`requestAnimationFrame`, never advances CSS transitions, and won't accept programmatic
scroll. So the reveal **animation** itself could not be watched here — only its logic was
verified (classes applied/withheld correctly). Worth eyeballing the actual easing in a real
browser. This same pane behaviour also leaves the existing load-screen stuck on screen,
which is pre-existing and unrelated to this pass.
