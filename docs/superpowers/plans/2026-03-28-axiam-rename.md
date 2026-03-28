# AxiAM Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the project from "GW2AM" / "GW2 Account Manager" to "AxiAM" with Cinzel-branded title bar text matching axibridge/axiforge.

**Architecture:** Find-and-replace across all code, config, and asset references. Replace PNG logo in title bar with Cinzel-styled HTML text (white "Axi" + deep red "AM"). Update CSP to allow Google Fonts CDN.

**Tech Stack:** Electron, React/TSX, CSS, Google Fonts (Cinzel)

---

### Task 1: Package metadata & HTML title

**Files:**
- Modify: `package.json`
- Modify: `index.html`

- [ ] **Step 1: Update package.json fields**

In `package.json`, apply these changes:

```json
"name": "axiam",
```

```json
"dev:update": "cross-env AXIAM_DEV_FAKE_UPDATE=1 AXIAM_DEV_FAKE_WHATS_NEW=1 npm run dev",
"dev:gw2_update": "cross-env AXIAM_DEV_FAKE_GW2_UPDATE=1 npm run dev",
"dev:showcase": "cross-env AXIAM_DEV_SHOWCASE=1 AXIAM_DEV_FAKE_WHATS_NEW=1 npm run dev",
```

```json
"appId": "com.axiam.app",
"productName": "AxiAM",
```

```json
"artifactName": "AxiAM-${version}-${os}-${arch}.${ext}",
```

```json
"repo": "axiam",
```

- [ ] **Step 2: Update index.html title and CSP**

In `index.html`, change the title:

```html
<title>AxiAM</title>
```

Update the CSP to allow Google Fonts:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;">
```

- [ ] **Step 3: Verify dev server starts**

Run: `npm run dev`
Expected: App launches with "AxiAM" in the system title bar. No CSP errors in console.

- [ ] **Step 4: Commit**

```bash
git add package.json index.html
git commit -m "chore: rename package metadata and HTML title to AxiAM"
```

---

### Task 2: Add Cinzel font and restyle title bar

**Files:**
- Modify: `src/index.css`
- Modify: `src/App.tsx`

- [ ] **Step 1: Import Cinzel font in index.css**

Add at the top of `src/index.css` (line 1, before `@tailwind base;`):

```css
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&display=swap');
```

- [ ] **Step 2: Add brand color CSS variable**

In `src/index.css`, inside the `:root` block, add:

```css
  --theme-brand-am: #8B1A1A;
```

- [ ] **Step 3: Rename .gw2am-mark to .axiam-mark and update SVG reference**

In `src/index.css`, rename the class and update the mask URLs:

```css
.axiam-mark {
  position: absolute;
  right: -220px;
  bottom: -110px;
  width: clamp(550px, 105vw, 1050px);
  aspect-ratio: 1 / 1;
  pointer-events: none;
  opacity: 0.2;
  z-index: 5;
  transform: translateY(20%) scaleX(-1);
  transform-origin: center;
  background:
    radial-gradient(circle at 30% 25%, var(--theme-gold-strong) 0%, var(--theme-accent) 48%, var(--theme-accent-strong) 100%);
  -webkit-mask-image: url('/img/AxiAM.svg');
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
  -webkit-mask-size: contain;
  mask-image: url('/img/AxiAM.svg');
  mask-repeat: no-repeat;
  mask-position: center;
  mask-size: contain;
}
```

- [ ] **Step 4: Replace title bar logo with Cinzel text in App.tsx**

There are three title bar instances in `src/App.tsx`. Replace all three. Each currently looks like:

```tsx
<img src="img/GW2AM.png" alt="GW2AM" className="w-4 h-4 object-contain" />
GW2 AM
```

Replace with (for the two smaller title bars at ~line 697 and ~line 729):

```tsx
<span style={{ fontFamily: '"Cinzel", serif', letterSpacing: '0.06em' }}>
    <span className="text-white">Axi</span><span style={{ color: 'var(--theme-brand-am)' }}>AM</span>
</span>
```

And for the main title bar (~line 766, which uses `w-5 h-5` and `text-sm`):

```tsx
<span style={{ fontFamily: '"Cinzel", serif', letterSpacing: '0.06em' }}>
    <span className="text-white">Axi</span><span style={{ color: 'var(--theme-brand-am)' }}>AM</span>
</span>
```

- [ ] **Step 5: Update watermark class reference in App.tsx**

At ~line 762, change:

```tsx
<div className="gw2am-mark" aria-hidden="true" />
```

to:

```tsx
<div className="axiam-mark" aria-hidden="true" />
```

- [ ] **Step 6: Verify title bar renders correctly**

Run: `npm run dev`
Expected: Title bar shows "AxiAM" in Cinzel font with white "Axi" and deep red "AM". Watermark still renders.

- [ ] **Step 7: Commit**

```bash
git add src/index.css src/App.tsx
git commit -m "feat: restyle title bar with Cinzel font and AxiAM branding"
```

---

### Task 3: Rename image assets

**Files:**
- Rename: `public/img/GW2AM.png` → `public/img/AxiAM.png`
- Rename: `public/img/GW2AM.svg` → `public/img/AxiAM.svg`
- Rename: `public/img/GW2AM-square.png` → `public/img/AxiAM-square.png`

- [ ] **Step 1: Rename the image files**

```bash
cd /var/home/mstephens/Documents/GitHub/GW2AM
git mv public/img/GW2AM.png public/img/AxiAM.png
git mv public/img/GW2AM.svg public/img/AxiAM.svg
git mv public/img/GW2AM-square.png public/img/AxiAM-square.png
```

- [ ] **Step 2: Commit**

```bash
git add -A public/img/
git commit -m "chore: rename image assets from GW2AM to AxiAM"
```

---

### Task 4: Electron main process rename

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Rename environment variable references**

At ~line 85-88, change:

```ts
const isDevFakeUpdate = process.env.AXIAM_DEV_FAKE_UPDATE === '1';
const isDevFakeWhatsNew = process.env.AXIAM_DEV_FAKE_WHATS_NEW === '1' || isDevFakeUpdate;
const isDevFakeGw2Update = process.env.AXIAM_DEV_FAKE_GW2_UPDATE === '1';
const isDevShowcase = process.env.AXIAM_DEV_SHOWCASE === '1';
```

- [ ] **Step 2: Rename log format**

At ~lines 141, 147, 153, change all three log functions from `[GW2AM]` to `[AxiAM]`:

```ts
const line = `[AxiAM][Main][${scope}] ${message}`;
```

- [ ] **Step 3: Rename diagnostics references**

At ~line 212-222, change:

```ts
const diagnosticsDir = path.join(app.getPath('documents'), 'AxiAM-Diagnostics');
```

```ts
const outPath = path.join(diagnosticsDir, `axiam-diagnostics-${stamp}.txt`);
```

```ts
'AxiAM Diagnostics',
```

- [ ] **Step 4: Rename Mumble link identifier**

At ~line 656, change:

```ts
return `axiam_${accountId.replace(/-/g, '').toLowerCase()}`;
```

- [ ] **Step 5: Rename flatpak/portal app ID references**

At ~lines 1169-1171 and ~lines 1220-1222, change both instances of the hardcoded app ID array entries:

```ts
'axiam',
'com.axiam',
'com.axiam.app',
```

- [ ] **Step 6: Rename flatpak error message**

At ~line 1229, change:

```ts
message: 'flatpak is not available, so AxiAM cannot auto-configure xdg-desktop-portal permissions on this system.',
```

- [ ] **Step 7: Rename icon path references**

At ~lines 1353-1354, change:

```ts
? path.join(__dirname, '../dist/img/AxiAM-square.png')
: path.join(process.cwd(), 'public/img/AxiAM-square.png');
```

- [ ] **Step 8: Rename app user model ID**

At ~line 1410, change:

```ts
app.setAppUserModelId('com.axiam.app');
```

- [ ] **Step 9: Rename GitHub API URL and User-Agent**

At ~line 1496-1502, change:

```ts
const releaseUrl = `https://api.github.com/repos/darkharasho/axiam/releases/tags/${tag}`;
```

```ts
'User-Agent': 'AxiAM-Updater',
```

- [ ] **Step 10: Verify app launches**

Run: `npm run dev`
Expected: App launches without errors. Check electron console for `[AxiAM][Main]` log prefix.

- [ ] **Step 11: Commit**

```bash
git add electron/main.ts
git commit -m "chore: rename all GW2AM references in electron main process to AxiAM"
```

---

### Task 5: Settings modal and GitHub URL

**Files:**
- Modify: `src/components/SettingsModal.tsx`

- [ ] **Step 1: Update GitHub URL**

At ~line 362, change:

```tsx
onClick={() => { void window.api.openExternal('https://github.com/darkharasho/axiam'); }}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SettingsModal.tsx
git commit -m "chore: update GitHub URL in settings modal to axiam"
```

---

### Task 6: Build scripts rename

**Files:**
- Modify: `scripts/run-electron-builder.mjs`
- Modify: `scripts/verify-windows-signing.mjs`
- Modify: `scripts/generate-release-notes.mjs`

- [ ] **Step 1: Update run-electron-builder.mjs**

At ~line 37, change:

```js
const buildAll = process.env.AXIAM_BUILD_ALL === '1';
```

- [ ] **Step 2: Update verify-windows-signing.mjs**

At line 3, change:

```js
const allowUnsigned = process.env.AXIAM_ALLOW_UNSIGNED_WINDOWS === '1';
```

At line 12, change:

```js
'[windows-signing] AXIAM_ALLOW_UNSIGNED_WINDOWS=1 set; skipping Windows signing checks. Artifacts are likely flagged by Smart App Control.'
```

At line 23, change:

```js
'[windows-signing] To bypass intentionally for testing only, set AXIAM_ALLOW_UNSIGNED_WINDOWS=1.'
```

- [ ] **Step 3: Update generate-release-notes.mjs**

At ~line 118, change:

```js
`Write friendly, non-technical release notes for the "AxiAM" app (v${version}).`,
```

- [ ] **Step 4: Commit**

```bash
git add scripts/run-electron-builder.mjs scripts/verify-windows-signing.mjs scripts/generate-release-notes.mjs
git commit -m "chore: rename GW2AM env vars and strings in build scripts to AxiAM"
```

---

### Task 7: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README title and references**

Change line 1 from:

```md
# <img width="42" height="47" alt="GW2AM" src="https://github.com/user-attachments/assets/1c349236-c3ca-4f1a-9882-6d91b86a2c0d" /> GW2 Account Manager
```

to:

```md
# <img width="42" height="47" alt="AxiAM" src="https://github.com/user-attachments/assets/1c349236-c3ca-4f1a-9882-6d91b86a2c0d" /> AxiAM
```

Change line 2 description from:

```md
A desktop account launcher for Guild Wars 2 focused on speed, security, and clean multi-account workflow.
```

to:

```md
A desktop account launcher focused on speed, security, and clean multi-account workflow.
```

Update the unsigned test builds section (~line 73):

```md
AXIAM_ALLOW_UNSIGNED_WINDOWS=1 npm run build:github
```

Update the GitHub link at the bottom:

```md
- GitHub: `https://github.com/darkharasho/axiam`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "chore: update README branding to AxiAM"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full-text search for any remaining GW2AM references**

```bash
cd /var/home/mstephens/Documents/GitHub/GW2AM
grep -ri "gw2am\|gw2.account.manager" --include='*.ts' --include='*.tsx' --include='*.css' --include='*.html' --include='*.json' --include='*.mjs' --include='*.md' -l
```

Expected: Only `docs/superpowers/specs/2026-03-28-local-dat-swap-design.md` and `docs/superpowers/plans/2026-03-28-local-dat-swap.md` (historical docs — intentionally left).

- [ ] **Step 2: Dev server smoke test**

Run: `npm run dev`
Expected: App launches, title bar shows Cinzel "AxiAM" branding, watermark renders, no console errors.

- [ ] **Step 3: Build test**

Run: `npm run build`
Expected: Build succeeds without errors.
