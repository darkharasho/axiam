# AxiAM redesign in axi-design — design spec

Date: 2026-09-23
Status: approved-pending-review

## Intent

Restyle AxiAM (the GW2 multi-account launcher) from its current glassmorphic
dark-red/gold idiom into the axi-design language used by axiom, axisite, and
axibridge — a full adoption in the axiom style (import the package, rewrite the
components), not a token-alias retrofit in the axibridge style.

Decisions made with the user:

- The 17 GW2-lore themes are **retired**. AxiAM adopts the same accent list as
  axibridge, and that list becomes **official in axi-design itself** — defined
  once in the `axi-design` repo, pushed, and consumed by apps.
- Typography goes fully on-language: system font stack, no webfonts. Cinzel and
  Outfit are removed entirely (including the wordmark).
- Ambient particles **and** confetti are both deleted.

## Part 1 — axi-design: the official accent list

Repo: `/var/home/mstephens/Documents/GitHub/axi-design` (published as
`@axiapps/axi-design`, currently 1.6.0).

The official accents are axibridge's 11 palette primaries (secondaries,
gradients, and alpha tints do not survive — rule 1 forbids gradients, rule 2
forbids colour at partial opacity over the ground; each accent is one hex):

| id | label | hex |
|---|---|---|
| `axi-gold` | Axi Gold (family default) | `#ffc53d` |
| `electric-blue` | Electric Blue | `#3b82f6` |
| `refined-cyan` | Refined Cyan | `#5eadd5` |
| `amber-warm` | Amber Warm | `#f59e0b` |
| `emerald-mint` | Emerald Mint | `#34d399` |
| `rose-pink` | Rose Pink | `#f43f5e` |
| `violet-purple` | Violet Purple | `#8b5cf6` |
| `crimson-red` | Crimson Red | `#ef4444` |
| `slate-silver` | Slate Silver | `#94a3b8` |
| `teal-ocean` | Teal Ocean | `#14b8a6` |
| `gold-bronze` | Gold Bronze | `#d4a017` |

Deliverables in the axi-design repo:

1. **`src/accents.css`** — one selector per accent:
   `[data-axi-accent="electric-blue"] { --axi-accent: #3b82f6; }` etc. Built
   into `dist/accents.css` by `scripts/build.mjs` (a second output, not
   concatenated into `axi.css` — accents are opt-in). Colour literals are
   allowed here by design; the file is an extension of `tokens.css`'s
   privilege, and `docs/RULES.md` gains a short section saying so and listing
   the official accents.
2. **`accents.json`** — `[{ "id", "label", "hex" }, …]` at the package root,
   for apps that render pickers/labels (axiam's settings grid, axibridge's
   picker can migrate later).
3. **`package.json`** — version → 1.7.0, exports gain `"./accents.css":
   "./dist/accents.css"` and `"./accents.json": "./accents.json"`;
   `sideEffects` keeps matching `*.css` only.
4. **Gallery** — `index.html`/`gallery.js` accent switcher reads the official
   list (its current five hardcoded swatches go; note the gallery's Violet
   `#b06bff` and Jade `#2fd38a` shift slightly to the official `#8b5cf6` /
   `#34d399`).
5. **`pages.yml`** — the per-tag staging loop also stages `dist/accents.css`
   (guarded so tags predating the file don't fail the build), keeping the
   `/v1/` CDN promise.
6. **Tests** — extend the existing vitest suite: dist matches source, JSON and
   CSS lists agree entry-for-entry.
7. **Release** — commit, push to `main`, tag `v1.7.0`, `npm publish` (access
   is already pinned public in `package.json`).

axisite and axibridge are untouched by this work (axisite's `#b06bff` accent
simply predates the official list; migrating them is out of scope).

## Part 2 — axiam: full adoption

Repo: `/var/home/mstephens/Documents/GitHub/axiam` (Electron 29 + React 18 +
Vite 5 + Tailwind 3.4, single frameless transparent 400×600 window).

### 2.1 Foundation

- `npm i @axiapps/axi-design@^1.7.0`.
- `src/main.tsx` imports, in order: `@axiapps/axi-design/axi.css`,
  `@axiapps/axi-design/accents.css`, then `./index.css`.
- `src/index.css` is rewritten from ~1,230 lines to a small app layer modeled
  on axiom's `globals.css`: frameless-window plumbing, compact-scale control
  variants suited to a 400×600 window, scrollbars, drag-region classes, and
  the handful of app-specific shapes (status dots, skeleton shimmer, giant
  background mark). No colour literals; every colour is an `--axi-*` token.
- Removed outright: the Google Fonts `@import` (and the
  `fonts.googleapis.com`/`fonts.gstatic.com` CSP entries in `index.html`),
  all `.glass*` classes, the noise-grain `body::after`, body glow gradients,
  accent gradients, `--window-radius` (corners go square), and every
  `backdrop-filter`.
- Tailwind stays for layout utilities only (flex/grid/spacing/sizing). Colour,
  radius, shadow, and blur utilities are removed from components as each is
  rewritten. `tailwind.config.js` stays stock.
- Deleted components: `AmbientParticles.tsx`, `Confetti.tsx` (and their mount
  points, keyframes, and the first-launch confetti trigger state).

### 2.2 Theming

- `src/themes/themes.ts` (554 lines, 17×27 vars) is replaced by a thin module
  that imports `@axiapps/axi-design/accents.json` and re-exports it as the
  theme list. `types.ts` shrinks to match.
- `applyTheme.ts` sets `data-axi-accent="<id>"` on `<html>` (the package CSS
  does the rest) instead of writing 27 inline vars. The 400ms
  `.theme-transitioning` cross-fade survives as a simple colour transition.
- Stored theme ids migrate to the nearest official accent, unknown ids fall
  back to `crimson-red`:

  | legacy id | accent |
  |---|---|
  | `blood_legion`, `dragonstorm` | `crimson-red` |
  | `charr_warband`, `ascalon_ember` | `amber-warm` |
  | `human_kryta`, `elonian_sun` | `axi-gold` |
  | `auric_basin` | `gold-bronze` |
  | `norn_shiverpeak`, `domain_of_ice` | `refined-cyan` |
  | `mistlock_fractal` | `electric-blue` |
  | `asura_inquest` | `teal-ocean` |
  | `sylvari_grove`, `jade_sea`, `verdant_canopy` | `emerald-mint` |
  | `priory_night` | `violet-purple` |
  | `crystal_bloom` | `rose-pink` |
  | `black_citadel` | `slate-silver` |
- **AxiAM's default accent is `crimson-red`** (keeps its red identity).
- The sidebar cycle button cycles the 11; the Settings grid shows 11 flat
  accent chips (ink outline, accent fill, label + no description) instead of
  17 gradient swatches.

### 2.3 Window shell

- Root becomes `.axi-window`: ground background, 4px ink border, and axiom's
  inset offset-block (`box-shadow: inset -6px -6px 0 0 var(--axi-ink-line)`)
  since a frameless window has nothing behind it to fall onto.
- Titlebar becomes `.axi-titlebar`: ink strip, micro-uppercase "AXIAM"
  wordmark beside the diamond sigil (`.axi-sigil` scaled down), version tag,
  Dev badge as an outlined chip, window buttons at titlebar height with
  close-hovers-danger. All `-webkit-app-region` drag/no-drag behavior is
  preserved. Both titlebar variants (main `h-8` and minimal `h-9`) unify on
  the axi titlebar with a flag for which buttons show.
- Update indicator becomes an `.axi-chip--meta` (outlined, the reserved cool
  ink — replacing today's hardcoded sky blue); its progress state is a length
  (rule 9), its spinner animates transform/opacity only (rule 11).
- The 44px left rail keeps its layout; buttons become flat ink-outlined
  squares with control hover-lifts. Add is the one accent-filled control.
- Search row becomes an `.axi-search` input (accent icon), no glass.

### 2.4 Components

- **AccountCard** — surface fill, 3px control border + 3px resting block,
  hover lift `translate(-2px,-2px)` with the block deepening. Avatar keeps the
  per-account hash hue but rendered flat (solid fill, ink outline, no radius).
  Status per rule 5 (filled asserts): running = filled `--ok` chip, launching
  / stopping = filled `--warn` chip with a transform/opacity work indicator
  (replacing the glow pulse — the uncommitted `.card-running::after` glow fix
  in `index.css` is superseded and removed), errored = filled `--danger`
  chip, idle = outlined neutral. A running card gets a top status cap
  (`--axi-card-strip`-style), never a side stripe or glow. Play button is an
  accent-filled square control; ripple and success-flash go. Expanded details
  panel becomes the card interior with `--axi-rule` separators (rule 8 style).
  Drag-reorder states restyle as lift + dashed drop target.
- **SettingsModal** — becomes the language's `.axi-drawer` + `.axi-scrim`.
  Section headings as eyebrows, inputs as `.axi-input`/`.axi-select`,
  the win32 multi-instance checkbox as `.axi-switch`, Discord/GitHub as
  outlined buttons. The nested confirm dialog becomes a centered `.axi-panel`
  over the scrim.
- **AddAccountModal** — stays a bottom sheet: surface fill, 4px ink top
  border, `.axi-input` fields with eyebrow labels, footer buttons in axi
  variants (Delete = danger-filled, Save = primary). Staggered field reveals
  go; one slide-up entrance remains.
- **MasterPasswordModal** — centered `.axi-panel` on the ground; lock glow,
  floating blob, watermark, and gold hairline go. Heading in axi h2, lock
  glyph on a flat accent plate, wide-tracked input preserved as a styling
  detail on `.axi-input`.
- **WhatsNewScreen** — `.axi-scrim` (no blur) over a panel with `.axi-prose`
  for the markdown; the custom element mapping in the component shrinks to
  nearly nothing.
- **ContextMenu** — `.axi-menu__pop` (ink border, block, danger item filled on
  hover).
- **Toast** — flat surface notice with ink border + block; `type: 'error'`
  finally styles (danger cap), `info` neutral.
- **Tooltip** — flat ink-outlined bubble, no radius, micro type.
- **SkeletonCards** — flat `--axi-surface` blocks with an opacity-only
  shimmer; the dead `skeleton-shimmer` class name gets defined or corrected.
- **Background mark** — the giant AxiAM.svg mask stays but static (no float)
  and drawn in solid `--axi-surface` (rule 2 forbids translucent accent over
  ground).
- **Hardcoded colours** — dev-badge amber → `--axi-warn`; update-badge
  sky/rose/emerald family → `--axi-meta`/`--axi-danger`/`--axi-ok`; all
  `text-white`/`amber-*` Tailwind colour classes replaced with tokens.

### 2.5 Motion

The ~25 keyframes reduce to roughly: work indicators (launching/stopping,
update spinner — transform/opacity only per rule 11), toast enter/exit,
menu/sheet/drawer entrances, skeleton shimmer, theme cross-fade. Hover
feedback comes from the language's lifts. `prefers-reduced-motion` is mostly
handled by axi's base layer; the app layer adds its remaining animations to a
short disable block.

### 2.6 Out of scope

- The marketing site (`marketing/`) and its screenshots — `npm run
  shots:marketing` output is invalidated; regeneration is a follow-up.
- The three native `confirm()`/`alert()` dialogs stay native.
- Migrating axibridge/axisite to the official accent list.
- Light mode.

## Error handling

- Legacy theme ids in stored settings must not crash `applyTheme` — unknown
  ids fall back to `crimson-red` after the migration map.
- The accents.json import is build-time (bundled), so there is no runtime
  fetch to fail.

## Testing & verification

- axi-design: vitest suite extended (dist-matches-src for `accents.css`;
  JSON/CSS parity), run before tagging.
- axiam: existing electron-side vitest suite must stay green (`--maxWorkers=2`
  per machine policy). No UI test suite exists; verification is visual — run
  `npm run dev:showcase` and screenshot every surface (main list with all
  status states, settings drawer, theme grid, add/edit sheet, vault screen
  both modes, What's New, context menu, toasts, update badge states) across at
  least three accents (crimson-red, axi-gold, electric-blue), checking each
  against `docs/RULES.md`.
- Grep-audit at the end: no `backdrop-filter`, no `gradient(` outside the
  select caret, no colour literals in `index.css`, no `rounded-*`/`shadow-*`
  Tailwind classes, no `Cinzel`/`Outfit`/`fonts.googleapis` references.

## Sequencing

Part 1 (axi-design 1.7.0) ships first — commit, push, tag, publish — because
Part 2 depends on the published `accents.css`/`accents.json`. Part 2 then
lands in axiam as one branch: foundation → theming → shell → components →
motion → cleanup/audit → visual verification.
