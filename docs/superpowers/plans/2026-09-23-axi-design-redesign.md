# AxiAM axi-design Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the official 11-accent list in axi-design 1.7.0, then restyle AxiAM's entire UI from glassmorphic to the axi-design language, consuming that list.

**Architecture:** Part 1 (Tasks 1–4) lands in the `axi-design` repo: `accents.json` becomes the single source of truth, `build.mjs` generates `dist/accents.css` from it (it cannot be a `src/*.css` file — the test suite requires `ORDER` to exactly match `src/` and forbids colour literals outside `tokens.css`), and 1.7.0 is tagged and published. Part 2 (Tasks 5–12) lands in `axiam` on a branch: import the package axiom-style, collapse the 17 GW2 themes to the 11 accents via `data-axi-accent`, rewrite `src/index.css` as a small app layer, and restyle every component.

**Tech Stack:** axi-design: plain CSS + Node 22 build script + vitest. axiam: Electron 29 + React 18 + TS + Vite 5 + Tailwind 3.4 (layout utilities only) + vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-axi-design-redesign-design.md` (in the axiam repo — read it first; it carries the rules context and the component-by-component design).

## Global Constraints

- Two repos: `/var/home/mstephens/Documents/GitHub/axi-design` and `/var/home/mstephens/Documents/GitHub/axiam`. Every task names its repo; `cd` there first.
- Vitest always runs with limited parallelism: `npx vitest run --maxWorkers=2` (axiam's `vitest.config.ts` already pins forks ≤ 2; axi-design's does not, so pass the flag).
- axi-design rules bind all new CSS in both repos: no gradients on surfaces, no colour at partial opacity over the ground, no blur/backdrop-filter/soft shadows, borders only 4px (panel) / 3px (control), blocks only via the `--axi-offset-*` tokens, radius 0, work indicators animate only `transform`/`opacity`.
- The axiam app layer (`src/index.css`) may contain **no colour literals** — every colour is an `--axi-*` token reference. (The one hue exception: the per-account avatar hash colour, which is computed in JS, not CSS.)
- AxiAM's default accent is `crimson-red`. axi-design's family default stays `axi-gold` (listed first in `accents.json`).
- The official accent list, exactly (id / label / hex): `axi-gold` / Axi Gold / `#ffc53d`, `electric-blue` / Electric Blue / `#3b82f6`, `refined-cyan` / Refined Cyan / `#5eadd5`, `amber-warm` / Amber Warm / `#f59e0b`, `emerald-mint` / Emerald Mint / `#34d399`, `rose-pink` / Rose Pink / `#f43f5e`, `violet-purple` / Violet Purple / `#8b5cf6`, `crimson-red` / Crimson Red / `#ef4444`, `slate-silver` / Slate Silver / `#94a3b8`, `teal-ocean` / Teal Ocean / `#14b8a6`, `gold-bronze` / Gold Bronze / `#d4a017`.
- Part 2 work happens on a branch `axi-design-redesign` in axiam. Part 1 lands directly on axi-design `main` (that repo releases from main tags).
- All axiam commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (same for axi-design commits).
- Preserve all `-webkit-app-region: drag` / `no-drag` behavior on the titlebar and its buttons — a frameless window with no drag region cannot be moved.
- axiam's `src/index.css` currently has an uncommitted working-tree modification (a `.card-running::after` glow fix). Task 7 rewrites the whole file; the fix is superseded and simply disappears — do not try to preserve it.

## Review Focus

1. **Legacy stored theme id on first boot after update** (`settings.themeId === 'blood_legion'` etc.) — must resolve to its mapped accent, never crash or render unaccented. → test in Task 6.
2. **Unknown/corrupt theme id** (`settings.themeId === 'garbage'` or `undefined`) — must fall back to `crimson-red`. → test in Task 6.
3. **A `v*` tag that predates `dist/accents.css`** — the Pages staging loop must neither fail the deploy nor publish an empty `accents.css` for that version. → guarded loop + local simulation step in Task 3.
4. **`prefers-reduced-motion: reduce`** — launching/stopping work indicators and the update spinner must stop animating while status stays legible via the chips. → CSS block in Task 7, manual check in Task 12.
5. **Accent persistence round-trip** — cycling the accent from the rail, restarting the app, and reopening Settings must show the same accent selected (the `themeId` settings key now stores an accent id). → manual check in Task 12; migration test in Task 6 covers the resolve path it depends on.

---

## Part 1 — axi-design 1.7.0

### Task 1: `accents.json` + generated `dist/accents.css`

Repo: `/var/home/mstephens/Documents/GitHub/axi-design`

**Files:**
- Create: `accents.json` (repo root)
- Create: `tests/accents.test.mjs`
- Modify: `scripts/build.mjs`
- Modify: `package.json` (exports + version)
- Generate: `dist/accents.css` (committed, like `dist/axi.css`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildAccentsCss(accents?)` and `ACCENTS` exported from `scripts/build.mjs`; package export paths `@axiapps/axi-design/accents.css` and `@axiapps/axi-design/accents.json`; the JSON shape `[{ "id": string, "label": string, "hex": string }, …]` that Tasks 2 and 6 rely on.

- [ ] **Step 1: Write `accents.json`**

```json
[
  { "id": "axi-gold", "label": "Axi Gold", "hex": "#ffc53d" },
  { "id": "electric-blue", "label": "Electric Blue", "hex": "#3b82f6" },
  { "id": "refined-cyan", "label": "Refined Cyan", "hex": "#5eadd5" },
  { "id": "amber-warm", "label": "Amber Warm", "hex": "#f59e0b" },
  { "id": "emerald-mint", "label": "Emerald Mint", "hex": "#34d399" },
  { "id": "rose-pink", "label": "Rose Pink", "hex": "#f43f5e" },
  { "id": "violet-purple", "label": "Violet Purple", "hex": "#8b5cf6" },
  { "id": "crimson-red", "label": "Crimson Red", "hex": "#ef4444" },
  { "id": "slate-silver", "label": "Slate Silver", "hex": "#94a3b8" },
  { "id": "teal-ocean", "label": "Teal Ocean", "hex": "#14b8a6" },
  { "id": "gold-bronze", "label": "Gold Bronze", "hex": "#d4a017" }
]
```

`axi-gold` is first because it is the family default. Order is presentation order for pickers.

- [ ] **Step 2: Write the failing tests** — `tests/accents.test.mjs`

```js
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildAccentsCss, ACCENTS } from '../scripts/build.mjs'

// dist/accents.css is committed for the same reason dist/axi.css is: the
// Pages workflow and npm both publish the artifact, and nothing in-repo
// imports it, so staleness would be invisible without this test.
describe('dist/accents.css', () => {
  it('matches the generation from accents.json', () => {
    const committed = readFileSync(resolve('dist/accents.css'), 'utf8')
    expect(committed).toBe(buildAccentsCss())
  })
})

describe('the official accent list', () => {
  it('has exactly the eleven official ids, axi-gold first', () => {
    expect(ACCENTS.map((a) => a.id)).toEqual([
      'axi-gold', 'electric-blue', 'refined-cyan', 'amber-warm',
      'emerald-mint', 'rose-pink', 'violet-purple', 'crimson-red',
      'slate-silver', 'teal-ocean', 'gold-bronze',
    ])
  })

  it('every entry is a kebab id, a label, and a 6-digit hex', () => {
    for (const a of ACCENTS) {
      expect(a.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(a.label.length).toBeGreaterThan(0)
      expect(a.hex).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('generates one data-attribute selector per accent and nothing structural', () => {
    const css = buildAccentsCss()
    for (const a of ACCENTS) {
      expect(css).toContain(`[data-axi-accent="${a.id}"] { --axi-accent: ${a.hex}; }`)
    }
    // Accents may set the accent and nothing else - a second declaration
    // would be a second theming surface.
    expect(css.match(/--axi-/g).length).toBe(ACCENTS.length)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `cd /var/home/mstephens/Documents/GitHub/axi-design && npx vitest run tests/accents.test.mjs --maxWorkers=2`
Expected: FAIL — `buildAccentsCss` is not exported.

- [ ] **Step 4: Implement in `scripts/build.mjs`**

Add below the existing `buildCss`:

```js
// The accents are data, not stylesheet source: accents.json is the single
// source of truth and this generation is the only way dist/accents.css comes
// to exist. It cannot live as src/accents.css - ORDER must match src/ exactly
// and colour literals are forbidden outside tokens.css; accents are the
// second sanctioned home for colour literals precisely because they are
// generated from the data file. Opt-in: never concatenated into axi.css.
export const ACCENTS = JSON.parse(readFileSync(resolve(ROOT, 'accents.json'), 'utf8'))

export function buildAccentsCss(accents = ACCENTS) {
  const rules = accents
    .map((a) => `[data-axi-accent="${a.id}"] { --axi-accent: ${a.hex}; }`)
    .join('\n')
  return `${BANNER}\n${rules}\n`
}
```

And extend the write-when-run-directly block:

```js
  writeFileSync(resolve(ROOT, 'dist/accents.css'), buildAccentsCss())
  console.log(`built dist/accents.css from ${ACCENTS.length} accent(s)`)
```

- [ ] **Step 5: Update `package.json`** — version `1.6.0` → `1.7.0`; exports become:

```json
  "exports": {
    "./axi.css": "./dist/axi.css",
    "./tokens.css": "./src/tokens.css",
    "./accents.css": "./dist/accents.css",
    "./accents.json": "./accents.json",
    "./package.json": "./package.json"
  },
```

(The existing `package exports` test iterates every entry and requires the target file to exist, so it starts covering the two new paths automatically.)

- [ ] **Step 6: Build and run the whole suite**

Run: `npm run build && npx vitest run --maxWorkers=2`
Expected: `dist/accents.css` written; all tests PASS (including the pre-existing suites — nothing in `ORDER` changed).

- [ ] **Step 7: Commit**

```bash
git add accents.json dist/accents.css scripts/build.mjs tests/accents.test.mjs package.json
git commit -m "feat: official accent list as accents.json + generated accents.css

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2: Gallery uses the official accents; RULES.md documents them

Repo: `/var/home/mstephens/Documents/GitHub/axi-design`

**Files:**
- Modify: `index.html` (the `#accent` select, ~lines 36–44)
- Modify: `docs/RULES.md`
- Modify: `tests/accents.test.mjs` (one more test)

**Interfaces:**
- Consumes: `ACCENTS` from `scripts/build.mjs`.
- Produces: nothing downstream; the gallery and rules simply agree with the list.

- [ ] **Step 1: Write the failing test** — append to `tests/accents.test.mjs`:

```js
describe('gallery accent switcher', () => {
  it('offers exactly the official accents, in order', () => {
    const html = readFileSync(resolve('index.html'), 'utf8')
    const select = html.match(/<select[^>]*id="accent"[\s\S]*?<\/select>/)[0]
    const options = [...select.matchAll(/<option value="(#[0-9a-f]{6})">([^<]+)<\/option>/g)]
      .map((m) => ({ hex: m[1], label: m[2] }))
    expect(options).toEqual(ACCENTS.map((a) => ({ hex: a.hex, label: a.label })))
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/accents.test.mjs --maxWorkers=2`
Expected: FAIL — the select still holds the five old swatches.

- [ ] **Step 3: Replace the `#accent` options in `index.html`**

```html
    <select class="axi-select" id="accent">
      <option value="#ffc53d">Axi Gold</option>
      <option value="#3b82f6">Electric Blue</option>
      <option value="#5eadd5">Refined Cyan</option>
      <option value="#f59e0b">Amber Warm</option>
      <option value="#34d399">Emerald Mint</option>
      <option value="#f43f5e">Rose Pink</option>
      <option value="#8b5cf6">Violet Purple</option>
      <option value="#ef4444">Crimson Red</option>
      <option value="#94a3b8">Slate Silver</option>
      <option value="#14b8a6">Teal Ocean</option>
      <option value="#d4a017">Gold Bronze</option>
    </select>
```

(`gallery.js` needs no change — it copies the select's value into `--axi-accent`. Note the gallery's old Violet `#b06bff` and Jade `#2fd38a` intentionally shift to the official `#8b5cf6` / `#34d399`.)

- [ ] **Step 4: Add an "Accents" section to `docs/RULES.md`** (after the existing "Light mode" section; match the doc's voice):

```markdown
## The official accents

`--axi-accent` is the per-app theming surface, and the family now agrees on
what may go in it. The official accents live in `accents.json` — id, label,
hex — and `dist/accents.css` is generated from it: one
`[data-axi-accent="<id>"]` selector per accent, setting `--axi-accent` and
nothing else. An app opts in by importing `accents.css` alongside `axi.css`
and setting `data-axi-accent` on its root element; an app that renders a
picker reads `accents.json` for the ids and labels.

accents.json is the second sanctioned home for a colour literal, after
tokens.css — sanctioned because it is data the build generates from, not
stylesheet source. Adding an accent means editing accents.json and running
the build; hand-editing dist/accents.css is exactly as wrong as hand-editing
dist/axi.css.

The default remains `#ffc53d` Axi Gold, declared in tokens.css: an app that
sets no `data-axi-accent` is gold, and correctly themed.
```

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run --maxWorkers=2`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html docs/RULES.md tests/accents.test.mjs
git commit -m "docs+gallery: adopt the official accent list

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3: Pages workflow stages `accents.css` per published version

Repo: `/var/home/mstephens/Documents/GitHub/axi-design`

**Files:**
- Modify: `.github/workflows/pages.yml` (the "Stage the gallery and every published version" step)

**Interfaces:**
- Produces: `https://darkharasho.github.io/axi-design/v1/accents.css` once a tag containing the file exists.

- [ ] **Step 1: Extend the staging loop.** Replace the loop body so each tag also stages `accents.css` when that tag has one — guarded, because every existing tag (≤ v1.6.0) predates the file, and `git show` failing must neither kill the build (`set -e` semantics in `run:`) nor leave a truncated empty file behind:

```yaml
          for tag in $(git tag -l 'v*' | sort -V); do
            major="${tag%%.*}"
            mkdir -p "_site/$major"
            git show "$tag:dist/axi.css" > "_site/$major/axi.css"
            echo "staged $tag -> /$major/axi.css"
            if git show "$tag:dist/accents.css" > "_site/$major/accents.css" 2>/dev/null; then
              echo "staged $tag -> /$major/accents.css"
            else
              rm -f "_site/$major/accents.css"
              echo "no accents.css in $tag (predates the accent list)"
            fi
          done
```

Note the ordering consequence this inherits from the existing loop: later tags overwrite earlier ones within a major, so `v1/accents.css` tracks the newest v1 tag — and the `rm -f` in the else-branch would remove a staged file only if a *newer* tag dropped `accents.css`, which is the correct behavior (a withdrawn file should not be republished from a stale iteration).

- [ ] **Step 2: Simulate the loop locally** (Review Focus #3) — from the repo root:

```bash
mkdir -p /tmp/axi-pages-sim && cd /tmp/axi-pages-sim && rm -rf _site && mkdir _site
cd /var/home/mstephens/Documents/GitHub/axi-design
set -e
for tag in $(git tag -l 'v*' | sort -V); do
  major="${tag%%.*}"; mkdir -p "/tmp/axi-pages-sim/_site/$major"
  git show "$tag:dist/axi.css" > "/tmp/axi-pages-sim/_site/$major/axi.css"
  if git show "$tag:dist/accents.css" > "/tmp/axi-pages-sim/_site/$major/accents.css" 2>/dev/null; then
    echo "staged $tag accents"
  else
    rm -f "/tmp/axi-pages-sim/_site/$major/accents.css"; echo "no accents in $tag"
  fi
done
ls -la /tmp/axi-pages-sim/_site/v1/
```

Expected: the loop completes for every historic tag ("no accents in v1.x" lines), no empty `accents.css` exists in `_site/v1/` before the v1.7.0 tag is created, and the shell exits 0 despite `set -e`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: stage accents.css per published version on Pages

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 4: Release axi-design 1.7.0

Repo: `/var/home/mstephens/Documents/GitHub/axi-design`

**Files:** none (release mechanics only).

- [ ] **Step 1: Final full test run**

Run: `npm run build && npx vitest run --maxWorkers=2 && git status --porcelain`
Expected: all PASS; `git status` clean (a dirty tree here means a build output wasn't committed — fix before tagging).

- [ ] **Step 2: Push and tag**

```bash
git push origin main
git tag v1.7.0
git push origin v1.7.0
```

- [ ] **Step 3: Watch the Pages deploy** (tag push triggers `pages.yml`; use the CI watcher card). Expected: green; the staging log shows `staged v1.7.0 -> /v1/accents.css`.

- [ ] **Step 4: Verify the CDN artifact**

Run: `curl -sf https://darkharasho.github.io/axi-design/v1/accents.css | head -5`
Expected: the banner plus `[data-axi-accent="axi-gold"] { --axi-accent: #ffc53d; }`. (Pages deploys can lag a minute; retry before concluding failure.)

- [ ] **Step 5: Publish to npm**

Run: `npm publish`
Expected: `+ @axiapps/axi-design@1.7.0` (access is pinned public in `package.json`). If auth fails, stop and report — the human owns npm credentials; do not improvise tokens.

- [ ] **Step 6: Verify the published package**

Run: `npm view @axiapps/axi-design@1.7.0 version && npm view @axiapps/axi-design@1.7.0 exports`
Expected: `1.7.0`; exports include `./accents.css` and `./accents.json`.

---

## Part 2 — axiam full adoption

All remaining tasks: repo `/var/home/mstephens/Documents/GitHub/axiam`, branch `axi-design-redesign` (create in Task 5). The dev loop for visual checks is `npm run dev:showcase` (fake accounts + update state, no vault needed).

### Task 5: Foundation — package in, decorations out

**Files:**
- Modify: `package.json` (+ `@axiapps/axi-design`)
- Modify: `src/main.tsx` (imports)
- Modify: `index.html` (CSP, default accent attribute)
- Delete: `src/components/AmbientParticles.tsx`, `src/components/Confetti.tsx`
- Modify: `src/App.tsx` (remove their mounts and the confetti trigger state)

**Interfaces:**
- Produces: `@axiapps/axi-design/axi.css` + `/accents.css` loaded before the app layer; `<html data-axi-accent="crimson-red">` as the pre-JS default. Tasks 6–12 assume both.

- [ ] **Step 1: Branch and install**

```bash
git checkout -b axi-design-redesign
npm i @axiapps/axi-design@^1.7.0
```

- [ ] **Step 2: Import order in `src/main.tsx`** — before the existing `import './index.css'`:

```ts
import '@axiapps/axi-design/axi.css';
import '@axiapps/axi-design/accents.css';
import './index.css';
```

- [ ] **Step 3: `index.html`** — set the default accent on the root element so first paint is crimson before `applyTheme` runs (no colour literal needed in CSS), and drop the webfont hosts from the CSP:

```html
<html lang="en" data-axi-accent="crimson-red">
```

```html
    <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline';">
```

- [ ] **Step 4: Delete the two decoration components**

```bash
git rm src/components/AmbientParticles.tsx src/components/Confetti.tsx
```

In `src/App.tsx`: remove both imports, the `<AmbientParticles />` and `<Confetti …/>` mounts, and the confetti trigger state (the `showConfetti`/first-launch-celebration `useState` + the code that sets it — search `Confetti` and `confetti`).

- [ ] **Step 5: Compile check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean (the app still *renders* old-styled — index.css untouched until Task 7 — but must compile).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: adopt @axiapps/axi-design 1.7.0; drop particles and confetti

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 6: Theming — 17 GW2 themes → 11 official accents

**Files:**
- Create: `src/themes/accents.ts`
- Create: `src/themes/accents.test.ts`
- Rewrite: `src/themes/applyTheme.ts`
- Delete: `src/themes/themes.ts`, `src/themes/types.ts`
- Modify: `src/App.tsx` (imports + `cycleTheme`), `src/components/SettingsModal.tsx` (imports + default ids), `electron/store.ts:50` (default `themeId`)

**Interfaces:**
- Consumes: `@axiapps/axi-design/accents.json` (`[{ id, label, hex }]`).
- Produces: `ACCENTS: AccentDefinition[]`, `DEFAULT_ACCENT_ID = 'crimson-red'`, `resolveAccentId(id?: string): string` from `src/themes/accents.ts`; `applyTheme(themeId?: string): string` keeps its existing signature (returns the resolved id) so callers in `App.tsx`/`SettingsModal.tsx` keep working. Task 10's Settings grid renders from `ACCENTS`.

- [ ] **Step 1: Write the failing tests** — `src/themes/accents.test.ts` (pure module, node env; `resolveJsonModule` is already on in `tsconfig.json`):

```ts
import { describe, it, expect } from 'vitest';
import { ACCENTS, DEFAULT_ACCENT_ID, resolveAccentId } from './accents';

describe('the accent list', () => {
    it('is the eleven official accents', () => {
        expect(ACCENTS).toHaveLength(11);
        expect(ACCENTS.map((a) => a.id)).toContain('crimson-red');
        expect(ACCENTS[0].id).toBe('axi-gold');
    });
});

describe('resolveAccentId', () => {
    it('passes an official id through', () => {
        expect(resolveAccentId('teal-ocean')).toBe('teal-ocean');
    });

    it('maps every legacy GW2 theme id per the spec table', () => {
        const table: Record<string, string> = {
            blood_legion: 'crimson-red', dragonstorm: 'crimson-red',
            charr_warband: 'amber-warm', ascalon_ember: 'amber-warm',
            human_kryta: 'axi-gold', elonian_sun: 'axi-gold',
            auric_basin: 'gold-bronze',
            norn_shiverpeak: 'refined-cyan', domain_of_ice: 'refined-cyan',
            mistlock_fractal: 'electric-blue',
            asura_inquest: 'teal-ocean',
            sylvari_grove: 'emerald-mint', jade_sea: 'emerald-mint', verdant_canopy: 'emerald-mint',
            priory_night: 'violet-purple',
            crystal_bloom: 'rose-pink',
            black_citadel: 'slate-silver',
        };
        for (const [legacy, accent] of Object.entries(table)) {
            expect(resolveAccentId(legacy)).toBe(accent);
        }
    });

    it('falls back to crimson-red for unknown and missing ids', () => {
        expect(resolveAccentId('garbage')).toBe(DEFAULT_ACCENT_ID);
        expect(resolveAccentId(undefined)).toBe(DEFAULT_ACCENT_ID);
        expect(DEFAULT_ACCENT_ID).toBe('crimson-red');
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/themes/accents.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/themes/accents.ts`**

```ts
import accentsJson from '@axiapps/axi-design/accents.json';

export type AccentDefinition = { id: string; label: string; hex: string };

export const ACCENTS: AccentDefinition[] = accentsJson;

export const DEFAULT_ACCENT_ID = 'crimson-red';

// Settings written by pre-redesign versions store a GW2 lore theme id.
const LEGACY_THEME_TO_ACCENT: Record<string, string> = {
    blood_legion: 'crimson-red',
    dragonstorm: 'crimson-red',
    charr_warband: 'amber-warm',
    ascalon_ember: 'amber-warm',
    human_kryta: 'axi-gold',
    elonian_sun: 'axi-gold',
    auric_basin: 'gold-bronze',
    norn_shiverpeak: 'refined-cyan',
    domain_of_ice: 'refined-cyan',
    mistlock_fractal: 'electric-blue',
    asura_inquest: 'teal-ocean',
    sylvari_grove: 'emerald-mint',
    jade_sea: 'emerald-mint',
    verdant_canopy: 'emerald-mint',
    priory_night: 'violet-purple',
    crystal_bloom: 'rose-pink',
    black_citadel: 'slate-silver',
};

export function resolveAccentId(id?: string): string {
    if (id && ACCENTS.some((a) => a.id === id)) return id;
    if (id && LEGACY_THEME_TO_ACCENT[id]) return LEGACY_THEME_TO_ACCENT[id];
    return DEFAULT_ACCENT_ID;
}
```

If `tsc` rejects the JSON import's type, add `as AccentDefinition[]` on the `accentsJson` use — but declare the array first, don't loosen the type.

- [ ] **Step 4: Rewrite `src/themes/applyTheme.ts`** (same signature; the 27-var loop and `data-theme` go, `data-axi-accent` arrives; the crossfade class survives — Task 7 defines it against `--axi-*` colours):

```ts
import { resolveAccentId } from './accents';

let transitionTimer: ReturnType<typeof setTimeout> | null = null;

export function applyTheme(themeId?: string): string {
    const id = resolveAccentId(themeId);
    const root = document.documentElement;

    root.classList.add('theme-transitioning');
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => {
        root.classList.remove('theme-transitioning');
        transitionTimer = null;
    }, 500);

    root.setAttribute('data-axi-accent', id);
    return id;
}
```

- [ ] **Step 5: Delete the old modules and repoint callers**

```bash
git rm src/themes/themes.ts src/themes/types.ts
```

- `src/App.tsx:14`: `import { GW2_THEMES } from './themes/themes';` → `import { ACCENTS } from './themes/accents';` and in `cycleTheme` (`App.tsx:784-794`) replace `GW2_THEMES` with `ACCENTS` (same `findIndex`/modulo shape — `t.id` still exists).
- `src/components/SettingsModal.tsx:3`: same import swap; the two `'blood_legion'` literals (lines 29 and 103) become `DEFAULT_ACCENT_ID` (import it). The theme-grid JSX still references `theme.vars` — it will not compile until its Task 10 rewrite, so in *this* task only make it compile minimally: swatch background becomes `accent.hex` (rename the map variable), drop the `vars` reads. Task 10 does the real restyle.
- `electron/store.ts:50`: `themeId: 'blood_legion',` → `themeId: 'crimson-red',`.

- [ ] **Step 6: Run tests + compile**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: new tests PASS, existing electron suite PASS, compile clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: collapse 17 GW2 themes to the 11 official axi accents

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 7: Rewrite `src/index.css` as the app layer

**Files:**
- Rewrite: `src/index.css` (~1,234 lines → the layer below)

**Interfaces:**
- Consumes: every `--axi-*` token and `.axi-*` class from the package.
- Produces: the app classes Tasks 8–11 reference: `.draggable`/`.no-drag`, `.am-rail`, `.am-rail-btn`, `.am-rail-btn--accent`, `.am-card`, `.am-card--running`, `.am-card--selected`, `.am-card--dragging`, `.am-card--drag-over`, `.am-avatar`, `.am-status-dot` (+ `--ok/--warn/--danger/--idle`), `.am-work`, `.am-mark`, `.am-sheet`, `.am-skeleton`, `.theme-transitioning`. Any class not in this list and not `.axi-*` must not appear in later tasks.

This is a whole-file replacement (the working tree's uncommitted glow fix is superseded). The new file, in full:

- [ ] **Step 1: Replace `src/index.css` with:**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* AxiAM app layer over @axiapps/axi-design (imported first in main.tsx).
   Frameless-window plumbing, the compact scale a 400x600 launcher needs,
   and the app's own shapes. No colour literals: every colour is a token. */

/* --- window plumbing --- */

html, body, #root { height: 100%; }
body { margin: 0; overflow: hidden; user-select: none; }

/* A frameless window has nothing behind it for a block to fall onto, so the
   window's offset block is drawn inward (the axiom pattern). */
.axi-window {
    box-shadow: inset calc(-1 * var(--axi-offset-panel)) calc(-1 * var(--axi-offset-panel)) 0 0 var(--axi-ink-line);
}

.draggable { -webkit-app-region: drag; }
.no-drag { -webkit-app-region: no-drag; }

/* --- accent crossfade (theme cycle) --- */

.theme-transitioning *,
.theme-transitioning *::before,
.theme-transitioning *::after {
    transition: background-color .4s ease, border-color .4s ease,
        color .2s ease, box-shadow .4s ease, outline-color .4s ease !important;
}

/* --- scrollbars --- */

::-webkit-scrollbar { width: 10px; }
::-webkit-scrollbar-track { background: var(--axi-ground); }
::-webkit-scrollbar-thumb {
    background: var(--axi-surface-raised);
    border: var(--axi-border-hairline) solid var(--axi-ink-line);
}
::-webkit-scrollbar-thumb:hover { background: var(--axi-rule); }

/* --- the giant background mark: static, solid surface ink (rule 2) --- */

.am-mark {
    position: fixed;
    inset: 0;
    pointer-events: none;
    background: var(--axi-surface);
    -webkit-mask: url('/img/AxiAM.svg') no-repeat center 55% / 130%;
    mask: url('/img/AxiAM.svg') no-repeat center 55% / 130%;
}

/* --- left rail --- */

.am-rail {
    width: 44px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 10px 0;
    border-right: var(--axi-border-control) solid var(--axi-ink-line);
}

.am-rail-btn {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    background: var(--axi-ground);
    color: var(--axi-text-dim);
    border: var(--axi-border-hairline) solid var(--axi-ink-line);
    transition: transform .1s ease, box-shadow .1s ease, color .1s ease;
}
.am-rail-btn:hover {
    color: var(--axi-text);
    transform: translate(-2px, -2px);
    box-shadow: var(--axi-offset-control) var(--axi-offset-control) 0 var(--axi-ink-line);
}
.am-rail-btn--accent {
    background: var(--axi-accent);
    color: var(--axi-accent-ink);
    border: var(--axi-border-hairline) solid var(--axi-ink-line);
}
.am-rail-btn--accent:hover { color: var(--axi-accent-ink); }

/* --- account cards --- */

.am-card {
    position: relative;
    background: var(--axi-surface);
    border: var(--axi-border-control) solid var(--axi-ink-line);
    box-shadow: var(--axi-offset-control) var(--axi-offset-control) 0 var(--axi-ink-line);
    transition: transform .1s ease, box-shadow .1s ease;
}
.am-card:hover {
    transform: translate(-2px, -2px);
    box-shadow: var(--axi-offset-control-hover) var(--axi-offset-control-hover) 0 var(--axi-ink-line);
}

/* Running is asserted with a top status cap (rule 5), never a stripe/glow. */
.am-card--running::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 5px;
    background: var(--axi-ok);
    border-bottom: var(--axi-border-hairline) solid var(--axi-ink-line);
}

.am-card--selected {
    outline: var(--axi-border-control) solid var(--axi-accent);
    outline-offset: 2px;
}

.am-card--dragging { opacity: .45; }
.am-card--drag-over { outline: var(--axi-border-control) dashed var(--axi-accent); outline-offset: 2px; }

.am-avatar {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: var(--axi-border-hairline) solid var(--axi-ink-line);
    font: var(--axi-t-label);
    letter-spacing: var(--axi-ls-label);
    text-transform: uppercase;
}

/* --- status --- */

.am-status-dot {
    width: 9px;
    height: 9px;
    display: inline-block;
    border: var(--axi-border-hairline) solid var(--axi-ink-line);
}
.am-status-dot--ok { background: var(--axi-ok); }
.am-status-dot--warn { background: var(--axi-warn); }
.am-status-dot--danger { background: var(--axi-danger); }
.am-status-dot--idle { background: var(--axi-surface-raised); }

/* Work indicator: compositor-only (rule 11). Blink by opacity, no scale of
   text-bearing layers. Applies to launching/stopping dots and the update
   badge's activity square. */
@keyframes am-work { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
.am-work { animation: am-work 1.1s ease-in-out infinite; }

/* --- bottom sheet (add/edit account) --- */

@keyframes am-sheet-in { from { transform: translateY(100%); } to { transform: translateY(0); } }
.am-sheet {
    background: var(--axi-surface);
    border-top: var(--axi-border-panel) solid var(--axi-ink-line);
    animation: am-sheet-in .18s ease-out;
}

/* --- skeleton --- */

@keyframes am-shimmer { 0%, 100% { opacity: .35; } 50% { opacity: .7; } }
.am-skeleton {
    background: var(--axi-surface);
    border: var(--axi-border-hairline) solid var(--axi-ink-line);
    animation: am-shimmer 1.4s ease-in-out infinite;
}

/* --- reduced motion: stop the work loops; state stays legible via chips --- */

@media (prefers-reduced-motion: reduce) {
    .am-work, .am-skeleton { animation: none; }
    .am-sheet { animation: none; }
    .am-card, .am-rail-btn { transition: none; }
    .theme-transitioning *,
    .theme-transitioning *::before,
    .theme-transitioning *::after { transition: none !important; }
}
```

- [ ] **Step 2: Guard-rail check on the new file** (the axiam version of the token contract — run from the repo root):

```bash
grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|color-mix\(|backdrop-filter|gradient\(' src/index.css
```

Expected: no output. (`grep` exiting 1 is the pass condition.)

- [ ] **Step 3: Look at the wreckage on purpose**

Run: `npm run dev:showcase` and look at the window.
Expected: the app is now visibly broken-but-flat — axi tokens active, old semantic classes (`.glass`, `.btn-primary`, …) rendering as unstyled boxes. That is correct for this commit; Tasks 8–11 rebuild the components. Verify only: no gradients, no blur, no rounded corners anywhere, crimson accent visible on focus rings.

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat: replace glassmorphic stylesheet with the axi-design app layer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 8: Shell — window, titlebars, rail, search, update badge

**Files:**
- Modify: `src/App.tsx` (root wrapper ~798, main titlebar 802–826, inline `TitleBar` 724–759, update indicator 501–544, rail 831–884, search 889–916)

**Interfaces:**
- Consumes: `.axi-window`, `.axi-titlebar`, `.axi-titlebar__btns`, `.axi-chip--meta`, `.axi-search`, `.axi-search__icon`, `.axi-input`, `.am-rail`, `.am-rail-btn(--accent)`, `.am-mark`, `.am-work`, `.draggable`/`.no-drag`.
- Produces: the shell structure Tasks 9–11's overlays mount inside. The two titlebar variants unify into one `TitleBar` component with a `minimal?: boolean` prop.

- [ ] **Step 1: Root + background mark.** The outermost div of the main branch (and of the auth-checking/locked branches) becomes:

```tsx
<div className="axi-window">
    <TitleBar minimal={false} … />
    <div className="am-mark" aria-hidden="true" />
    {/* row: rail + content */}
</div>
```

Remove the old `window-chrome`/radius wrappers and every `style={{ borderRadius: … }}`.

- [ ] **Step 2: One `TitleBar`.** Replace both existing titlebars with a single component; keep every existing handler (`onMinimize`, `onMaximize`, `onClose`, What's New) and the drag regions:

```tsx
function TitleBar({ minimal, version, isDev, updateState, onWhatsNew, onMinimize, onMaximize, onClose }: TitleBarProps) {
    return (
        <header className="axi-titlebar draggable">
            <span className="axi-diamond" aria-hidden="true" />
            <span>AXIAM</span>
            <span style={{ color: 'var(--axi-text-faint)' }}>v{version}</span>
            {isDev && <span className="axi-chip">DEV</span>}
            {updateState && <UpdateBadge state={updateState} />}
            <div className="axi-titlebar__btns no-drag">
                {!minimal && <button onClick={onMinimize} aria-label="Minimize"><Minus size={13} /></button>}
                {!minimal && <button onClick={onMaximize} aria-label="Maximize"><Square size={11} /></button>}
                <button onClick={onClose} aria-label="Close"><X size={13} /></button>
            </div>
        </header>
    );
}
```

(The package's `.axi-titlebar` supplies the ink strip, micro type, drag ergonomics of a 38px bar; `.axi-titlebar__btns button:last-child:hover` supplies close-hovers-danger. Gap/padding via one `style={{ display:'flex', alignItems:'center', gap: 8 }}` if the package spacing needs help — no new CSS classes.)

- [ ] **Step 3: Update badge** (`App.tsx:501-544`) — the pill becomes a meta chip; progress is drawn as length (rule 9):

```tsx
<span className="axi-chip axi-chip--meta no-drag" onClick={…existing…}>
    {downloading && <span className="am-status-dot am-status-dot--idle am-work" aria-hidden="true" />}
    {label /* e.g. "UPDATE 42%" or "RESTART" */}
</span>
```

Delete the `updateBadge`/`updateRing`/`updateShimmer`/`updateGlow` keyframe consumers and the hardcoded sky/rose/emerald inline styles; error state swaps `--meta` for a filled `axi-chip--danger`.

- [ ] **Step 4: Rail** (`App.tsx:831-884`) — container class `am-rail`; every button `am-rail-btn no-drag` (Add: `am-rail-btn am-rail-btn--accent`); the divider becomes `<hr style={{ width: 22, border: 0, borderTop: 'var(--axi-border-hairline) solid var(--axi-rule)' }} />`. Keep all Tooltip wrappers and handlers.

- [ ] **Step 5: Search row** (`App.tsx:889-916`):

```tsx
<div className="axi-search" style={{ margin: '10px 12px 0' }}>
    <Search size={14} className="axi-search__icon" />
    <input className="axi-input" placeholder="Search accounts…" … />
</div>
```

Drop the expand/collapse keyframes; a conditional render (open/closed) is enough.

- [ ] **Step 6: Compile + look**

Run: `npx tsc --noEmit -p tsconfig.json`, then `npm run dev:showcase`.
Expected: ink titlebar with working drag + min/max/close (close hover turns danger-red), flat rail with lifting buttons, accent Add button, search row in the language. Cards still half-broken (Task 9).

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: axi shell - window, titlebar, rail, search, update badge

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 9: AccountCard

**Files:**
- Modify: `src/components/AccountCard.tsx`
- Modify: `src/App.tsx` (list container + empty/no-match states, ~919–967)

**Interfaces:**
- Consumes: `.am-card` family, `.am-avatar`, `.am-status-dot--*`, `.am-work`, `.axi-chip` variants, `.axi-btn`, `--axi-rule`.
- Produces: nothing downstream.

- [ ] **Step 1: Card container.** Root div: `.glass rounded-xl p-3 …` → `am-card p-3` plus state classes mapped 1:1: `card-running`→`am-card--running`, `card-selected`→`am-card--selected`, `card-dragging`→`am-card--dragging`, `card-drag-over`→`am-card--drag-over`. Remove the staggered `animationDelay` inline style and the `cardEnter` class.

- [ ] **Step 2: Avatar** (`AccountCard.tsx:53-59, 186-187`): keep the hsl-hash colours (JS-computed, the sanctioned exception) but render on `.am-avatar` — drop `rounded-*`.

- [ ] **Step 3: Status.** Replace the dot+label cluster with rule-5 chips; filled asserts, outlined annotates:

```tsx
const STATUS_CHIP: Record<Status, { cls: string; dot: string; work: boolean }> = {
    running:   { cls: 'axi-chip axi-chip--ok',     dot: 'am-status-dot--ok',     work: false },
    launching: { cls: 'axi-chip axi-chip--warn',   dot: 'am-status-dot--warn',   work: true },
    stopping:  { cls: 'axi-chip axi-chip--warn',   dot: 'am-status-dot--warn',   work: true },
    errored:   { cls: 'axi-chip axi-chip--danger', dot: 'am-status-dot--danger', work: false },
    idle:      { cls: 'axi-chip',                  dot: 'am-status-dot--idle',   work: false },
};
// …
<span className={STATUS_CHIP[status].cls}>
    <span className={`am-status-dot ${STATUS_CHIP[status].dot} ${STATUS_CHIP[status].work ? 'am-work' : ''}`} aria-hidden="true" />
    {statusLabel}
</span>
```

The resolved API account name stays beside it as plain `--axi-text-faint` text (meta, not status). The inferred-vs-verified certainty flag renders as `axi-chip--meta` (outlined — an annotation) only when inferred.

- [ ] **Step 4: Actions.** Play/Stop: `className="axi-btn axi-btn--primary no-drag"` sized square via `style={{ padding: 8 }}`; remove `.btn-play`, ripple, and success-flash JSX. Chevron/gear/gift: `am-rail-btn` (it is exactly the flat 30px square these want). Keep all handlers and the context-menu wiring.

- [ ] **Step 5: Details panel.** The expanding `.card-details` becomes the card interior with rules, not outlines (rule 8): wrapper `style={{ borderTop: 'var(--axi-border-hairline) solid var(--axi-rule)' }}`, rows as label/value pairs — label `font: var(--axi-t-micro)` uppercase `--axi-text-faint`, value `--axi-text-dim`. Height animation may stay if it animates `max-height`+`opacity` on the container only.

- [ ] **Step 6: Empty/no-match states** (`App.tsx`): drop `emptyFloat`/`emptyFade`; render an `.axi-panel` with an eyebrow (`.axi-eyebrow`) and a `.axi-btn--dashed` "Add your first account".

- [ ] **Step 7: Compile + look** — `npx tsc --noEmit -p tsconfig.json`; in showcase mode verify: hover lift, running card's green top cap, blinking warn dot while "launching", selection outline, drag reorder states.

- [ ] **Step 8: Commit**

```bash
git add src/components/AccountCard.tsx src/App.tsx
git commit -m "feat: account cards in the axi language

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 10: The three modals

**Files:**
- Modify: `src/components/SettingsModal.tsx`, `src/components/AddAccountModal.tsx`, `src/components/MasterPasswordModal.tsx`

**Interfaces:**
- Consumes: `.axi-drawer`, `.axi-scrim`, `.axi-panel`, `.axi-input`, `.axi-select`, `.axi-switch`, `.axi-btn` variants, `.axi-eyebrow`, `.am-sheet`, `ACCENTS`/`DEFAULT_ACCENT_ID` from Task 6.
- Produces: nothing downstream.

- [ ] **Step 1: SettingsModal → drawer.** Scrim div: `className="axi-scrim"` (delete the `backdropFilter: blur(2px)` inline style — forbidden). Drawer div: `className="axi-drawer"` (package supplies surface, ink border, width; keep `max-w-md` if narrower is needed). Section headings → `<div className="axi-eyebrow">GW2 Path</div>` etc. Inputs → `.axi-input`; the master-password-prompt `<select>` → `.axi-select`; the win32 multi-instance checkbox → `.axi-switch` markup:

```tsx
<button role="switch" aria-checked={enabled} className="axi-switch" onClick={toggle}>
    <span className="axi-switch__knob" />
</button>
```

Discord/GitHub → `.axi-btn` (ghost). The nested confirm dialog (387–433): overlay `.axi-scrim`, box `.axi-panel`, buttons `.axi-btn--primary` / `.axi-btn`.

- [ ] **Step 2: Theme grid → accent grid.** Replace the 17-swatch `GW2_THEMES.map` (from Task 6 it already compiles against `ACCENTS`) with:

```tsx
<div className="grid grid-cols-6 gap-2">
    {ACCENTS.map((a) => (
        <button
            key={a.id}
            title={a.label}
            aria-pressed={a.id === themeId}
            onClick={() => { setThemeId(a.id); applyTheme(a.id); }}
            style={{
                height: 28,
                background: a.hex,
                border: 'var(--axi-border-hairline) solid var(--axi-ink-line)',
                outline: a.id === themeId ? 'var(--axi-border-control) solid var(--axi-text)' : 'none',
                outlineOffset: 2,
            }}
        />
    ))}
</div>
<p style={{ font: 'var(--axi-t-small)', color: 'var(--axi-text-dim)' }}>
    {ACCENTS.find((a) => a.id === themeId)?.label}
</p>
```

Keep the hover-preview behavior (`previewThemeRef`) if trivially portable; otherwise delete it — click-to-apply with autosave is the contract.

- [ ] **Step 3: AddAccountModal → sheet.** Container: `am-sheet` replacing the `.glass`/slide keyframe classes; keep `top-9`→ below the titlebar via `style={{ top: 38 }}`. All fields `.axi-input` with `.axi-eyebrow` labels; remove every staggered `animationDelay`; footer: Save = `.axi-btn--primary`; Delete = `.axi-btn` with `style={{ color: 'var(--axi-danger)' }}` (danger *text* on a plain button — a filled danger surface is the chip idiom for status, not an action; the existing native `confirm()` guard stays, per spec out-of-scope).

- [ ] **Step 4: MasterPasswordModal → centered panel.** Full-screen wrapper: plain `background: var(--axi-ground)` (no vignette/glow/watermark divs — delete them). Card: `.axi-panel` centered, max-width 320. Lock icon on a flat accent plate (`.am-rail-btn--accent` at 40px via `style={{ width: 40, height: 40 }}`). Heading `style={{ font: 'var(--axi-t-h2)', letterSpacing: 'var(--axi-ls-h2)' }}` (no Cinzel). Inputs `.axi-input` (keep `letterSpacing` for the password dots if wanted); error line `color: 'var(--axi-danger)'`; submit `.axi-btn--primary` full-width; Hard Reset stays a quiet `.axi-btn--ghost` with danger text colour.

- [ ] **Step 5: Compile + look** — `npx tsc --noEmit -p tsconfig.json`; showcase: open Settings (drawer + accent grid works end-to-end: click Teal Ocean, whole app re-accents with crossfade), open Add Account (flat sheet), relaunch with vault to see the lock panel (or temporarily flip the render branch).

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsModal.tsx src/components/AddAccountModal.tsx src/components/MasterPasswordModal.tsx
git commit -m "feat: settings drawer, account sheet, vault screen in axi

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 11: Overlays — What's New, context menu, toasts, tooltip, skeletons

**Files:**
- Modify: `src/components/WhatsNewScreen.tsx`, `src/components/ContextMenu.tsx`, `src/components/Toast.tsx`, `src/components/Tooltip.tsx`, `src/components/SkeletonCards.tsx`

**Interfaces:**
- Consumes: `.axi-scrim`, `.axi-panel`, `.axi-prose`, `.axi-menu__pop`, `.am-skeleton`, `.am-card`.
- Produces: nothing downstream.

- [ ] **Step 1: WhatsNewScreen.** Overlay: `.axi-scrim` (delete `backdropFilter: blur(8px)`), positioned below the titlebar (`style={{ top: 38 }}`). Body: an `.axi-panel` holding `<div className="axi-prose">` around `<ReactMarkdown remarkPlugins={[remarkGfm]}>…` — delete the entire custom `components={…}` element mapping (Cinzel h1, glass pre, accent blockquote); `.axi-prose` owns markdown styling now. Keep the header row (close button = `am-rail-btn`, title as `.axi-eyebrow`, version as `.axi-chip`).

- [ ] **Step 2: ContextMenu.** `.context-menu` → `.axi-menu__pop` (keep the viewport clamping and fixed positioning logic); items become plain buttons with `font: var(--axi-t-label)`, hover `background: var(--axi-surface-raised)`; the danger item hovers `background: var(--axi-danger); color: var(--axi-accent-ink)`; divider `borderTop: var(--axi-border-hairline) solid var(--axi-rule)`. Delete `contextMenuIn/Out` keyframe classes (instant open is on-language).

- [ ] **Step 3: Toast.** Pill → notice: `className="axi-panel"` with `style={{ padding: '10px 14px', display: 'flex', gap: 8 }}`; `type === 'error'` finally styles — prepend `<span className="am-status-dot am-status-dot--danger" />`; `info` gets `--idle`. Keep enter/exit but as `transform: translateY` + `opacity` transitions (delete `toastEnter/Exit` keyframes if they animate anything else).

- [ ] **Step 4: Tooltip.** `.tooltip-bubble` styles inline on the fixed div: `background: var(--axi-ink-line)`, `color: var(--axi-text)`, `border: var(--axi-border-hairline) solid var(--axi-rule)`, `font: var(--axi-t-micro)`, `padding: '5px 8px'`. Keep delay/positioning logic; delete `tooltipIn`.

- [ ] **Step 5: SkeletonCards.** Each placeholder: `<div className="am-card am-skeleton" style={{ height: 62 }} />` — this also retires the dead `skeleton-shimmer` class name.

- [ ] **Step 6: Compile + look** — `npx tsc --noEmit -p tsconfig.json`; showcase: What's New renders prose cleanly, right-click menu is flat ink, toasts show the danger dot on error, tooltips flat, skeletons shimmer by opacity.

- [ ] **Step 7: Commit**

```bash
git add src/components
git commit -m "feat: overlays in the axi language

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 12: Sweep, audit, verify

**Files:**
- Modify: anything the audits flag (expect stragglers in `src/App.tsx` and components: `text-white`, `amber-*`, `rounded-*`, `shadow-*`, leftover `.glass`/`.btn-*`/`.section-label`/`.sidebar-btn` class names)
- Modify: `README.md:101` (the "custom glassmorphic design system" line → "React 18 with Tailwind layout utilities over @axiapps/axi-design")

- [ ] **Step 1: Dead-class and forbidden-idiom audit** — every command must produce no output:

```bash
grep -rnE 'glass|btn-primary|btn-play|section-label|sidebar-btn|theme-swatch|input-glass|context-menu|tooltip-bubble|skeleton-block|card-running|card-selected|card-dragging|status-chip|status-dot--|fab|axiam-mark|particle' src --include='*.tsx' --include='*.ts'
grep -rnE 'rounded-|shadow-|blur|backdrop' src --include='*.tsx'
grep -rnE 'Cinzel|Outfit|fonts\.googleapis|fonts\.gstatic' src index.html
grep -rnE '--theme-' src electron
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(' src/index.css
grep -rnE 'text-white|amber-[0-9]|sky-[0-9]|emerald-[0-9]|rose-[0-9]' src --include='*.tsx'
```

Fix every hit (replace with tokens/axi classes per the mappings in Tasks 8–11; the avatar's `hsl(` computed in `AccountCard.tsx` JS is the one sanctioned exception — leave it).

- [ ] **Step 2: Full test + compile**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: all PASS; production build succeeds.

- [ ] **Step 3: Visual verification in showcase mode** — `npm run dev:showcase`, walk every surface and check against `docs/RULES.md` in the axi-design repo. Checklist:
  - main list: idle/launching/running/errored cards (running = green top cap; launching = blinking warn dot)
  - hover lift on cards, rail buttons, primary buttons
  - selection outline; drag reorder (drag a card over another)
  - search open/filter/no-match state; empty state (delete accounts in showcase or filter to nothing)
  - Settings drawer: every section, the accent grid — click through **crimson-red, axi-gold, electric-blue** and confirm the whole app re-accents (Review Focus #5: also restart the app once and confirm the accent stuck)
  - Add/Edit sheet; nested confirm dialog (toggle multi-instance on win32 config — on Linux verify the dialog by temporarily rendering it if not reachable)
  - vault screen (both set/verify modes), What's New, context menu, toasts (error + info), tooltips, skeletons, update badge (showcase fakes update state — check downloading %, restart, and error variants)
  - OS-level `prefers-reduced-motion: reduce` (GNOME: `gsettings set org.gnome.desktop.interface enable-animations false`): work indicators freeze, chips still tell the status (Review Focus #4); revert the setting after.
- [ ] **Step 4: Screenshot the finished surfaces** (main list, settings + accent grid, add sheet, vault, What's New — at crimson-red) for the final report.

- [ ] **Step 5: Update README and commit**

```bash
git add -A
git commit -m "chore: sweep legacy classes, audit against the axi rules

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Finish the branch** — run the superpowers:finishing-a-development-branch skill (merge/PR decision belongs to the human).
