// Capture marketing-site screenshots from a real AxiAM run.
//
// Usage:  npm run build && npm run build:electron && node scripts/take-marketing-screenshots.mjs
//
// Two passes:
//   1. Showcase mode (fake accounts, fake What's New) → vault, settings,
//      account-edit, whats-new — all themed to Priory Night.
//   2. Fresh non-showcase profile → master-password setup prompt.
//
// Output: marketing/assets/screenshots/*.png

import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const OUT_DIR = path.join(ROOT, 'marketing', 'assets', 'screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const MAIN_ENTRY = path.join(ROOT, 'dist-electron', 'main.js');
if (!fs.existsSync(MAIN_ENTRY)) {
  console.error(`Build output missing: ${MAIN_ENTRY}\nRun: npm run build && npm run build:electron`);
  process.exit(1);
}

// AxiAM ships with a "Priory Night" theme — used for all marketing shots so
// the gallery has one coherent look. CSS vars mirror src/themes/themes.ts.
const PRIORY_NIGHT_VARS = {
  '--theme-bg': '#0d1118',
  '--theme-surface': '#121923',
  '--theme-surface-soft': '#1a2431',
  '--theme-border': '#2f3d52',
  '--theme-text': '#e7edf6',
  '--theme-title': '#dbe4f0',
  '--theme-text-muted': '#a9b6c8',
  '--theme-text-dim': '#8391a6',
  '--theme-input-bg': '#101620',
  '--theme-accent': '#6a4ba6',
  '--theme-accent-strong': '#8d69cc',
  '--theme-accent-soft': 'rgba(106, 75, 166, 0.22)',
  '--theme-gold': '#b89259',
  '--theme-gold-strong': '#d3ac72',
  '--theme-control-bg': '#232f40',
  '--theme-control-hover': '#2f3d52',
  '--theme-danger-soft': '#3f3457',
  '--theme-danger-text': '#b7a1e0',
  '--theme-danger-text-hover': '#d5c6f0',
  '--theme-active-border': '#8d69cc',
  '--theme-active-ring': 'rgba(141,105,204,0.45)',
  '--theme-body-start': '#0e141d',
  '--theme-glow-1': 'rgba(184, 146, 89, 0.10)',
  '--theme-glow-2': 'rgba(141, 105, 204, 0.14)',
  '--theme-overlay': 'rgba(0,0,0,0.45)',
};

function baseEnv() {
  const env = { ...process.env };
  delete env.VITE_DEV_SERVER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

async function applyPrioryNight(win) {
  // Persist the choice so any settings-driven re-renders also pick it up.
  await win.evaluate(async () => {
    try {
      const current = await window.api.getSettings();
      await window.api.saveSettings({ ...(current ?? {}), themeId: 'priory_night' });
    } catch { /* ignore */ }
  });
  // Directly apply the theme tokens — mirrors src/themes/applyTheme.ts.
  await win.evaluate((vars) => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'priory_night');
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }
  }, PRIORY_NIGHT_VARS);
}

async function sizeWindow(app, width, height) {
  await app.evaluate(({ BrowserWindow }, { w, h }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    win.unmaximize();
    win.setSize(w, h);
    win.center();
  }, { w: width, h: height });
}

// ===========================================================================
// Pass 1 — showcase mode: vault, settings, account-edit, whats-new
// ===========================================================================

async function passShowcase() {
  console.log('[shots] pass 1: launching AxiAM in showcase mode');
  const env = baseEnv();
  env.AXIAM_DEV_SHOWCASE = '1';
  env.AXIAM_DEV_FAKE_WHATS_NEW = '1';

  const app = await electron.launch({ args: [MAIN_ENTRY], env });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  // AxiAM defaults to 400x600 (electron/main.ts getStoredWindowState).
  await sizeWindow(app, 400, 600);
  await win.waitForTimeout(700);

  const shot = async (name) => {
    const file = path.join(OUT_DIR, `${name}.png`);
    await win.screenshot({ path: file });
    console.log(`[shots]   wrote ${name}.png`);
  };

  // Wait for showcase accounts to render.
  console.log('[shots] waiting for showcase accounts');
  await win.waitForFunction(() => /WvW Main/.test(document.body.innerText), null, { timeout: 20000 });

  await applyPrioryNight(win);
  await win.waitForTimeout(400);

  // What's New auto-opens with AXIAM_DEV_FAKE_WHATS_NEW=1.
  const whatsNewVisible = await win.evaluate(() => /What['’]s New/i.test(document.body.innerText));
  if (whatsNewVisible) {
    await win.waitForTimeout(400);
    await shot('whats-new');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(700);
  }

  // Vault — every account idle. showcaseActiveAccounts starts empty.
  await win.waitForTimeout(300);
  await shot('vault');
  fs.copyFileSync(path.join(OUT_DIR, 'vault.png'), path.join(OUT_DIR, 'hero-app.png'));
  console.log('[shots]   duplicated vault.png -> hero-app.png');

  // Live stats — click Launch on the first account so exactly one is running.
  console.log('[shots] launching first account for live-stats shot');
  const launched = await win.evaluate(() => {
    const playBtn = Array.from(document.querySelectorAll('button'))
      .find(b => b.querySelector('svg.lucide-play'));
    if (playBtn) { playBtn.click(); return true; }
    return false;
  });
  if (launched) {
    // Wait for the card to flip to running state (svg.lucide-square present).
    await win.waitForFunction(
      () => document.querySelector('svg.lucide-square') !== null,
      null,
      { timeout: 8000 },
    ).catch(() => {});
    await win.waitForTimeout(600);
    await shot('live-stats');
  }

  // Settings.
  console.log('[shots] opening settings');
  const settingsClicked = await win.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => b.querySelector('svg.lucide-settings'));
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (settingsClicked) {
    await win.waitForTimeout(700);
    await shot('settings');
    await win.evaluate(() => {
      const backdrop = document.querySelector('[aria-label="Close Settings"]');
      if (backdrop instanceof HTMLElement) backdrop.click();
    });
    await win.waitForTimeout(700);
  }

  // Account-edit modal — Add Account (Plus icon).
  console.log('[shots] opening account editor');
  const editClicked = await win.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => b.querySelector('svg.lucide-plus'));
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (editClicked) {
    await win.waitForTimeout(700);
    await shot('account-edit');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);
  }

  await app.close();
}

// ===========================================================================
// Pass 2 — fresh profile, no showcase: master-password setup screen
// ===========================================================================

async function passMasterPassword() {
  console.log('[shots] pass 2: fresh profile for master-password prompt');

  // Use an isolated user-data dir so we get the first-launch experience
  // (no existing salt → master-password "set" modal is shown).
  const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'axiam-shots-'));

  const env = baseEnv();
  // No AXIAM_DEV_SHOWCASE — we want the real password gate to show.

  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${tmpProfile}`],
    env,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await sizeWindow(app, 400, 600);
  await win.waitForTimeout(800);

  // Wait for the master-password modal to appear. Both "set" and "verify"
  // modes contain the phrase "Master Password" in the heading.
  try {
    await win.waitForFunction(
      () => /master password/i.test(document.body.innerText),
      null,
      { timeout: 12000 },
    );
  } catch {
    console.warn('[shots] master-password modal never appeared');
    await app.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    return;
  }

  await applyPrioryNight(win);
  await win.waitForTimeout(400);

  const file = path.join(OUT_DIR, 'master-password.png');
  await win.screenshot({ path: file });
  console.log('[shots]   wrote master-password.png');

  await app.close();
  fs.rmSync(tmpProfile, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------

await passShowcase();
await passMasterPassword();
console.log(`[shots] done — ${OUT_DIR}`);
