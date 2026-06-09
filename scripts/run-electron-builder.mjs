#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, 'package.json');

/**
 * Work around broken 32-bit Wine on the build host. electron-builder edits the
 * Windows exe's icon/version resources by running `rcedit-ia32.exe` under Wine
 * (the choice is hardcoded in app-builder — there's no flag to pick the 64-bit
 * build). Modern Wine in new-WoW64 mode (e.g. wine-staging 11) can't execute
 * 32-bit PEs at all, so that step crashes ("noexec filesystem" mapping
 * syswow64\\ntdll.dll) and the whole Windows build fails. The shipped
 * rcedit-x64.exe runs fine, so we point the cached ia32 path at the x64 binary.
 *
 * This lives here (touching the electron-builder cache) rather than in
 * node_modules because the release pipeline runs `npm install`, which would
 * revert any node_modules patch. The swap is idempotent and re-applied every
 * build, so it also survives the cache being repopulated.
 */
function ensureWorkingRceditForWine() {
  if (process.platform !== 'linux') return;
  const cacheRoot = process.env.ELECTRON_BUILDER_CACHE
    || path.join(os.homedir(), '.cache', 'electron-builder');
  const signRoot = path.join(cacheRoot, 'winCodeSign');
  if (!fs.existsSync(signRoot)) {
    console.warn(`[run-electron-builder] winCodeSign cache not present yet at ${signRoot}; `
      + `if the Windows build fails on rcedit-ia32 under Wine, re-run once the cache is populated.`);
    return;
  }
  for (const entry of fs.readdirSync(signRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(signRoot, entry.name);
    const ia32 = path.join(dir, 'rcedit-ia32.exe');
    const x64 = path.join(dir, 'rcedit-x64.exe');
    if (!fs.existsSync(ia32) || !fs.existsSync(x64)) continue;
    const marker = path.join(dir, '.rcedit-ia32.is-x64');
    if (fs.existsSync(marker)) continue; // already swapped this cache copy
    const backup = `${ia32}.orig`;
    if (!fs.existsSync(backup)) fs.copyFileSync(ia32, backup);
    fs.copyFileSync(x64, ia32);
    fs.writeFileSync(marker, 'rcedit-ia32.exe replaced with rcedit-x64.exe: 32-bit Wine is broken on this host\n');
    console.log(`[run-electron-builder] patched ${ia32} -> 64-bit rcedit (broken 32-bit Wine workaround)`);
  }
}

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) return;
    const key = match[1];
    let value = match[2] ?? '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
};

loadEnvFile(path.join(rootDir, '.env'));

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const outputDirName = packageJson?.build?.directories?.output || 'dist_out';
const outputDir = path.join(rootDir, outputDirName);
if (fs.existsSync(outputDir)) {
  fs.rmSync(outputDir, { recursive: true, force: true });
}

const buildAll = process.env.AXIAM_BUILD_ALL === '1';
const platformArgs = buildAll
  ? ['--linux', '--win']
  : process.platform === 'win32'
    ? ['--win']
    : process.platform === 'linux'
      ? ['--linux']
      : ['--win'];
const args = ['electron-builder', ...platformArgs, '--publish', 'never'];

// When building for Windows on a Linux host, make sure the rcedit step won't
// crash on broken 32-bit Wine (see ensureWorkingRceditForWine).
if (platformArgs.includes('--win')) {
  ensureWorkingRceditForWine();
}

const runEnv = { ...process.env };
if (
  process.platform === 'win32' &&
  !runEnv.CSC_LINK &&
  !runEnv.WIN_CSC_LINK &&
  !runEnv.CSC_NAME &&
  !runEnv.WIN_CSC_NAME &&
  !runEnv.CSC_IDENTITY_AUTO_DISCOVERY
) {
  // Keep local Windows builds unsigned without trying cert auto-discovery/signing helpers.
  runEnv.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
}
const isWin = process.platform === 'win32';
const result = isWin
  ? spawnSync('cmd.exe', ['/d', '/s', '/c', `npx ${args.join(' ')}`], { stdio: 'inherit', env: runEnv })
  : spawnSync('npx', args, { stdio: 'inherit', env: runEnv });

if (result.error) {
  console.error(`[run-electron-builder] failed to start: ${result.error.message}`);
  process.exit(1);
}

if ((result.status ?? 1) !== 0) {
  console.error(`[run-electron-builder] electron-builder failed with exit code ${result.status ?? 1}`);
}

process.exit(result.status ?? 1);
