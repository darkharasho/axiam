import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import log from 'electron-log';
import electronUpdaterPkg from 'electron-updater';
import store from './store.js';
import type { Account, AppSettings } from './types.js';
import { deriveKey, encrypt, generateSalt } from './crypto.js';
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import os from 'os';
import { LaunchStateMachine } from './launchStateMachine.js';
import { hasLocalDat, deleteLocalDat, getSteamLibraryPaths, migrateLegacyLocalDat, installSnapshotToHost, snapshotHostToAccount, getAccountLocalDatPath, seedAccountLocalDatFromHost } from './localDat.js';
import { injectDll } from './dllInjector.js';
import { migrateGw2DirToJunction, repointJunction, unmigrateJunctionToRealDir } from './junction.js';
import * as launchSerializer from './launchSerializer.js';
import {
  gw2DatPath,
  gw2ExePath,
  isPatchNeeded,
  createStabilityState,
  stepStability,
  type StabilityConfig,
} from './patchDetector.js';
import { quitWatcher } from './quitWatcher.js';
import {
  getHelperPath,
  runMutexCloserDirect,
  runMutexCloserUnderProton,
  resolveProtonContext,
  type MutexCloserResult,
} from './mutexCloser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const { autoUpdater } = electronUpdaterPkg;

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// Dev-only userData override so local iteration doesn't collide with a real
// AxiAM install. Set AXIAM_DEV_DATA_DIR to an absolute path before `npm run dev`.
if (process.env.AXIAM_DEV_DATA_DIR) {
  app.setPath('userData', process.env.AXIAM_DEV_DATA_DIR);
}

// ─── Migration: clean up stale updater cache from pre-rename installs ────────
// If left behind, electron-updater can pick up the old cache and try to
// unlink a non-existent AppImage path, blocking future updates.
{
  const cacheHome = process.env.XDG_CACHE_HOME || path.join(app.getPath('home'), '.cache');
  const oldUpdaterCache = path.join(cacheHome, 'gw2-account-manager-updater');
  if (fs.existsSync(oldUpdaterCache)) {
    try {
      fs.rmSync(oldUpdaterCache, { recursive: true });
      log.info('[Migration] Removed stale gw2-account-manager-updater cache');
    } catch (err: any) {
      log.warn('[Migration] Failed to remove old updater cache:', err?.message || err);
    }
  }
}

// ─── Migration: rename AppImage/portable binary from GW2AM to AxiAM ─────────
{
  if (app.isPackaged) {
    const legacyPrefix = 'GW2AM';
    const newPrefix = 'AxiAM';

    if (process.platform === 'linux') {
      const appImagePath = process.env.APPIMAGE;
      if (appImagePath) {
        const baseName = path.basename(appImagePath);
        if (baseName.startsWith(legacyPrefix) && !baseName.startsWith(newPrefix)) {
          const newName = baseName.replace(legacyPrefix, newPrefix);
          const targetPath = path.join(path.dirname(appImagePath), newName);
          if (!fs.existsSync(targetPath)) {
            try {
              fs.copyFileSync(appImagePath, targetPath);
              fs.chmodSync(targetPath, 0o755);
              log.info(`[Migration] Created new AppImage name: ${targetPath}`);
            } catch (err: any) {
              log.warn(`[Migration] Failed to copy AppImage to new name: ${err?.message || err}`);
            }
          }
        }
      }
    }

    if (process.platform === 'win32') {
      const portablePath = process.env.PORTABLE_EXECUTABLE;
      if (portablePath) {
        const baseName = path.basename(portablePath);
        if (baseName.startsWith(legacyPrefix) && !baseName.startsWith(newPrefix)) {
          const newName = baseName.replace(legacyPrefix, newPrefix);
          const targetPath = path.join(path.dirname(portablePath), newName);
          if (!fs.existsSync(targetPath)) {
            try {
              fs.copyFileSync(portablePath, targetPath);
              log.info(`[Migration] Created new portable name: ${targetPath}`);
            } catch (err: any) {
              log.warn(`[Migration] Failed to copy portable exe to new name: ${err?.message || err}`);
            }
          }
        }
      }
    }
  }
}

let mainWindow: BrowserWindow | null = null;
let masterKey: Buffer | null = null;
let shutdownRequested = false;
const launchStateMachine = new LaunchStateMachine();

const SAFE_STORAGE_PREFIX = 'safe:';
const STEAM_GW2_APP_ID = '1284210';
const WINDOWS_PROCESS_SNAPSHOT_TTL_MS = 1500;
const LINUX_PROCESS_WAIT_TIMEOUT_MS = 180000;
const LAUNCH_DWELL_AFTER_DETECTED_MS = 4000;
const LAUNCH_DWELL_MULTI_INSTANCE_MS = 20000;
const INSTALL_RETRY_TOTAL_MS = 3000;
const INSTALL_RETRY_INTERVAL_MS = 200;
const QUIT_WATCHER_POLL_INTERVAL_MS = 2000;
// Per-account launch context used by the quit handler to decide whether to
// snapshot the host Local.dat back into the profile.
//
// `installed=true` means the host file was populated from this account's own
// snapshot at launch — saving it back is always safe (worst case: re-save same
// data). `installed=false` means no snapshot existed; the host could hold any
// previous account's credentials. In that case we only snapshot if the user
// stayed in GW2 long enough to plausibly have authenticated (the elapsed
// threshold below), otherwise a quick Stop would clobber this account's
// profile with the prior account's data.
interface LaunchContext {
  installed: boolean;
  startedAtMs: number;
}
const launchContexts = new Map<string, LaunchContext>();
const FRESH_LAUNCH_MIN_SAVE_MS = 15000;
let windowsProcessSnapshotCache: { timestamp: number; processes: any[] } = { timestamp: 0, processes: [] };
let resolvedWindowsPowerShellPath: string | null = null;
// Windows fallback: when WMI returns null CommandLine (e.g. for elevated GW2
// processes), mumble-name matching fails. We bind a "new pid that appeared
// during this account's launch window" to the account here so detection still
// works. Cleared when the pid exits or the user stops the account.
const manualAccountPidBindings = new Map<string, number>();

function encryptForStorage(key: Buffer): string {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(key.toString('hex'));
    return SAFE_STORAGE_PREFIX + encrypted.toString('base64');
  }
  log.warn('safeStorage encryption not available â€” falling back to plaintext key cache');
  return key.toString('hex');
}

function decryptFromStorage(stored: string): Buffer | null {
  try {
    if (stored.startsWith(SAFE_STORAGE_PREFIX)) {
      const encrypted = Buffer.from(stored.slice(SAFE_STORAGE_PREFIX.length), 'base64');
      const hex = safeStorage.decryptString(encrypted);
      return Buffer.from(hex, 'hex');
    }
    // Legacy plaintext hex â€” read as-is
    return Buffer.from(stored, 'hex');
  } catch {
    return null;
  }
}
let persistWindowStateTimer: NodeJS.Timeout | null = null;
let autoUpdateEnabled = false;
const isDevFakeUpdate = process.env.AXIAM_DEV_FAKE_UPDATE === '1';
const isDevFakeWhatsNew = process.env.AXIAM_DEV_FAKE_WHATS_NEW === '1' || isDevFakeUpdate;
const isDevShowcase = process.env.AXIAM_DEV_SHOWCASE === '1';
let fakeUpdateTimer: NodeJS.Timeout | null = null;
const showcaseActiveAccounts = new Set<string>();
const showcaseAccounts = [
  {
    id: 'showcase-a',
    nickname: 'WvW Main',
    email: 'wvw.main@example.com',
    passwordEncrypted: '',
    launchArguments: '-windowed -mapLoadinfo -fps 60',
    apiKey: 'showcase-key-1',
    apiAccountName: 'DarkHarasho.1234',
    apiCreatedAt: '2018-03-12T10:05:00Z',
  },
  {
    id: 'showcase-b',
    nickname: 'PvE Alt',
    email: 'pve.alt@example.com',
    passwordEncrypted: '',
    launchArguments: '-dx11 -windowed',
    apiKey: 'showcase-key-2',
    apiAccountName: 'LightHerald.5678',
    apiCreatedAt: '2021-07-04T13:22:00Z',
  },
  {
    id: 'showcase-c',
    nickname: 'Raid Support',
    email: 'raid.support@example.com',
    passwordEncrypted: '',
    launchArguments: '-windowed -shareArchive',
    apiKey: 'showcase-key-3',
    apiAccountName: 'QuickBoon.9012',
    apiCreatedAt: '2019-11-21T18:44:00Z',
  },
] as const;

log.transports.file.level = 'info';
if (app.isPackaged) {
  // AppImage can run without an attached terminal; avoid writing logs to broken stdio pipes.
  log.transports.console.level = false;
}
autoUpdater.logger = log;

process.stdout?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return;
  throw err;
});
process.stderr?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return;
  throw err;
});

function logMain(scope: string, message: string): void {
  const line = `[AxiAM][Main][${scope}] ${message}`;
  console.log(line);
  log.info(line);
}

function logMainWarn(scope: string, message: string): void {
  const line = `[AxiAM][Main][${scope}] ${message}`;
  console.warn(line);
  log.warn(line);
}

function logMainError(scope: string, message: string): void {
  const line = `[AxiAM][Main][${scope}] ${message}`;
  console.error(line);
  log.error(line);
}

function resolveWindowsPowerShellPath(): string {
  if (resolvedWindowsPowerShellPath) return resolvedWindowsPowerShellPath;
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const candidates = [
    path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    path.join(systemRoot, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    'powershell.exe',
  ];
  for (const candidate of candidates) {
    if (!candidate.toLowerCase().endsWith('.exe') || fs.existsSync(candidate)) {
      resolvedWindowsPowerShellPath = candidate;
      return candidate;
    }
  }
  resolvedWindowsPowerShellPath = 'powershell.exe';
  return resolvedWindowsPowerShellPath;
}

function invalidateWindowsProcessSnapshot(): void {
  windowsProcessSnapshotCache = { timestamp: 0, processes: [] };
}

function isWindowsPidRunning(pid: number): boolean {
  if (process.platform !== 'win32') return false;
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const command = `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`;
  const result = spawnSync(resolveWindowsPowerShellPath(), ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' });
  return result.status === 0;
}

function readFileTail(filePath: string, maxBytes = 200 * 1024): string {
  if (!fs.existsSync(filePath)) return '';
  const stats = fs.statSync(filePath);
  const size = stats.size;
  const start = Math.max(0, size - maxBytes);
  const bytesToRead = Math.max(0, size - start);
  if (bytesToRead <= 0) return '';
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytesToRead);
    fs.readSync(fd, buffer, 0, bytesToRead, start);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function exportDiagnosticsBundle(): { success: boolean; path?: string; message: string } {
  try {
    const now = new Date();
    const iso = now.toISOString();
    const stamp = iso.replace(/[:.]/g, '-');
    const logsDir = path.join(app.getPath('userData'), 'logs');
    const mainLogPath = path.join(logsDir, 'main.log');
    const diagnosticsDir = path.join(app.getPath('documents'), 'AxiAM-Diagnostics');
    fs.mkdirSync(diagnosticsDir, { recursive: true });
    const outPath = path.join(diagnosticsDir, `axiam-diagnostics-${stamp}.txt`);

    const settings = (store.get('settings') as AppSettings | undefined) || null;
    const accounts = ((store.get('accounts') as Account[] | undefined) || []);
    const launchStates = launchStateMachine.getAllStates();
    const logTail = readFileTail(mainLogPath);

    const content = [
      'AxiAM Diagnostics',
      `GeneratedAt: ${iso}`,
      '',
      'Runtime',
      `Version: ${app.getVersion()}`,
      `Packaged: ${String(app.isPackaged)}`,
      `Platform: ${process.platform}`,
      `Arch: ${process.arch}`,
      `Electron: ${process.versions.electron}`,
      `Node: ${process.versions.node}`,
      '',
      'Paths',
      `UserData: ${app.getPath('userData')}`,
      `LogsDir: ${logsDir}`,
      `MainLog: ${mainLogPath}`,
      '',
      'State',
      `AccountCount: ${accounts.length}`,
      `LaunchStates: ${JSON.stringify(launchStates, null, 2)}`,
      `Settings: ${JSON.stringify(settings, null, 2)}`,
      '',
      'RecentMainLog',
      logTail || '(main.log not found or empty)',
      '',
    ].join('\n');

    fs.writeFileSync(outPath, content, 'utf8');
    shell.showItemInFolder(outPath);
    logMain('diagnostics', `Exported diagnostics bundle: ${outPath}`);
    return { success: true, path: outPath, message: 'Diagnostics exported successfully.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logMainError('diagnostics', `Failed to export diagnostics: ${message}`);
    return { success: false, message: `Failed to export diagnostics: ${message}` };
  }
}



/** Capture mouse position relative to the window under the cursor (uses WINDOW from getmouselocation). */








type StoredWindowState = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
};

function getStoredWindowState(): StoredWindowState {
  const raw = (store.get('windowState') as Partial<StoredWindowState> | undefined) || {};
  const width = Number.isFinite(raw.width) && (raw.width as number) > 200 ? Number(raw.width) : 400;
  const height = Number.isFinite(raw.height) && (raw.height as number) > 200 ? Number(raw.height) : 600;
  const x = Number.isFinite(raw.x) ? Number(raw.x) : undefined;
  const y = Number.isFinite(raw.y) ? Number(raw.y) : undefined;
  const isMaximized = Boolean(raw.isMaximized);
  return { x, y, width, height, isMaximized };
}

function persistWindowState(immediate = false): void {
  if (!mainWindow) return;

  const writeState = () => {
    if (!mainWindow) return;
    const normalBounds = mainWindow.getNormalBounds();
    const nextState: StoredWindowState = {
      x: normalBounds.x,
      y: normalBounds.y,
      width: normalBounds.width,
      height: normalBounds.height,
      isMaximized: mainWindow.isMaximized(),
    };
    store.set('windowState', nextState);
  };

  if (immediate) {
    if (persistWindowStateTimer) {
      clearTimeout(persistWindowStateTimer);
      persistWindowStateTimer = null;
    }
    writeState();
    return;
  }

  if (persistWindowStateTimer) {
    clearTimeout(persistWindowStateTimer);
  }
  persistWindowStateTimer = setTimeout(() => {
    persistWindowStateTimer = null;
    writeState();
  }, 250);
}

function requestAppShutdown(source: string): void {
  if (shutdownRequested) return;
  shutdownRequested = true;
  console.log(`Shutdown requested via ${source}`);
  try {
    app.quit();
  } catch {
    // Ignore and rely on forced exit fallback below.
  }
  setTimeout(() => {
    app.exit(0);
  }, 1200);
}

function sendUpdaterEvent(channel: string, payload?: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}


function setupAutoUpdater(): void {
  autoUpdater.on('checking-for-update', () => {
    log.info('[AutoUpdater] Checking for update...');
    sendUpdaterEvent('update-message', 'Checking for update...');
  });
  autoUpdater.on('update-available', (info) => {
    log.info('[AutoUpdater] Update available', info);
    sendUpdaterEvent('update-available', info);
  });
  autoUpdater.on('update-not-available', (info) => {
    log.info('[AutoUpdater] Update not available', info);
    sendUpdaterEvent('update-not-available', info);
  });
  autoUpdater.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`[AutoUpdater] Error: ${message}`);
    sendUpdaterEvent('update-error', { message });
  });
  autoUpdater.on('download-progress', (progress) => {
    sendUpdaterEvent('download-progress', progress);
  });
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[AutoUpdater] Update downloaded', info);
    sendUpdaterEvent('update-downloaded', info);
  });
}

async function checkForUpdates(reason: 'startup' | 'manual'): Promise<void> {
  if (isDevFakeUpdate) {
    if (fakeUpdateTimer) {
      clearTimeout(fakeUpdateTimer);
      fakeUpdateTimer = null;
    }
    sendUpdaterEvent('update-message', `Checking for update (${reason})...`);
    fakeUpdateTimer = setTimeout(() => {
      sendUpdaterEvent('update-available', { version: `${app.getVersion()}+fake` });
      let percent = 0;
      const interval = setInterval(() => {
        percent = Math.min(100, percent + 20);
        sendUpdaterEvent('download-progress', {
          percent,
          bytesPerSecond: 1500000,
          transferred: Math.floor(percent * 1024 * 1024),
          total: 100 * 1024 * 1024,
        });
        if (percent >= 100) {
          clearInterval(interval);
          sendUpdaterEvent('update-downloaded', { version: `${app.getVersion()}+fake` });
        }
      }, 350);
    }, 900);
    return;
  }

  if (!autoUpdateEnabled) {
    sendUpdaterEvent('update-error', { message: 'Auto-updates are unavailable for this build.' });
    return;
  }

  if (!app.isPackaged) {
    log.info(`[AutoUpdater] Skipping ${reason} update check in development mode.`);
    sendUpdaterEvent('update-not-available', { version: app.getVersion() });
    return;
  }

  try {
    await Promise.race([
      autoUpdater.checkForUpdates(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Update check timed out after 30s')), 30000)),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`[AutoUpdater] ${reason} update check failed: ${message}`);
    sendUpdaterEvent('update-error', { message });
  }
}

process.on('SIGINT', () => requestAppShutdown('SIGINT'));
process.on('SIGTERM', () => requestAppShutdown('SIGTERM'));

function splitLaunchArguments(launchArguments?: string): string[] {
  if (!launchArguments) return [];
  const matches = launchArguments.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  if (!matches) return [];
  return matches.map((arg) => arg.replace(/^['"]|['"]$/g, ''));
}

function getAccountMumbleName(accountId: string): string {
  return `axiam_${accountId.replace(/-/g, '').toLowerCase()}`;
}

function stripManagedLaunchArguments(args: string[]): string[] {
  const valueTakingFlags = new Set(['--mumble', '-mumble']);
  const standaloneFlags = new Set(['-autologin', '--autologin']);
  const cleaned: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const lowerArg = arg.toLowerCase();

    if (valueTakingFlags.has(lowerArg)) {
      i += 1;
      continue;
    }

    if (
      lowerArg.startsWith('--mumble=') ||
      lowerArg.startsWith('-mumble=')
    ) {
      continue;
    }

    if (standaloneFlags.has(lowerArg)) {
      continue;
    }
    cleaned.push(arg);
  }
  return cleaned;
}

function extractMumbleNameFromCommandLine(commandLine: string): string | null {
  const match = commandLine.match(/(?:^|\s)(?:--mumble|-mumble)(?:=|\s+)("([^"]+)"|'([^']+)'|([^\s"']+))/i);
  if (!match) return null;
  return match[2] || match[3] || match[4] || null;
}

function getWindowsProcessSnapshot(): any[] {
  if (process.platform !== 'win32') return [];
  const now = Date.now();
  if (now - windowsProcessSnapshotCache.timestamp < WINDOWS_PROCESS_SNAPSHOT_TTL_MS) {
    return windowsProcessSnapshotCache.processes;
  }

  const query = 'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress';
  const result = spawnSync(resolveWindowsPowerShellPath(), ['-NoProfile', '-NonInteractive', '-Command', query], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) {
    logMainWarn('windows-process', `PowerShell snapshot failed status=${result.status ?? 'null'} stderr=${String(result.stderr || '').trim()}`);
    return windowsProcessSnapshotCache.processes;
  }

  try {
    const parsed = JSON.parse(result.stdout);
    const processes = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    windowsProcessSnapshotCache = { timestamp: now, processes };
    return processes;
  } catch {
    return windowsProcessSnapshotCache.processes;
  }
}

function launchViaSteam(args: string[]): void {
  if (process.platform === 'linux') {
    const child = spawn('steam', ['-applaunch', STEAM_GW2_APP_ID, ...args], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (spawnError) => {
      logMainError('launch', `Steam spawn failed: ${spawnError.message}`);
    });
    child.unref();
    return;
  }

  if (process.platform === 'win32') {
    const encodedArgs = encodeURIComponent(args.join(' '));
    const steamUri = `steam://rungameid/${STEAM_GW2_APP_ID}//${encodedArgs}`;
    const child = spawn('cmd.exe', ['/c', 'start', '""', steamUri], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return;
  }

  // Fallback for other platforms with desktop integration.
  const encodedArgs = encodeURIComponent(args.join(' '));
  const steamUri = `steam://rungameid/${STEAM_GW2_APP_ID}//${encodedArgs}`;
  const child = spawn('xdg-open', [steamUri], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

const PATCH_STABILITY_CONFIG: StabilityConfig = {
  quietWindowMs: 10_000,
  graceWindowMs: 20_000,
  ceilingMs: 300_000,
};
const PATCH_POLL_INTERVAL_MS = 2_000;
const PATCH_TEARDOWN_SETTLE_MS = 2_000;

/**
 * Resolve the GW2 install directory for patch detection. Prefers an explicit
 * Gw2-64.exe path (the direct-launch path on Windows); otherwise falls back to
 * auto-location (covers Linux/Steam). Returns null when nothing is found, in
 * which case the caller skips patch detection entirely.
 */
function resolveGw2InstallDir(gw2Path?: string): string | null {
  if (gw2Path && fs.existsSync(gw2Path)) {
    return path.dirname(gw2Path);
  }
  const located = autoLocateGw2ExecutablePath();
  if (located.found && located.path && fs.existsSync(located.path)) {
    return path.dirname(located.path);
  }
  return null;
}

/** statSync helper that returns null instead of throwing on a missing file. */
function safeMtimeMs(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

/** Sample Gw2.dat size+mtime, or null if it can't be read. */
function sampleGw2Dat(datPath: string): { size: number; mtimeMs: number } | null {
  try {
    const st = fs.statSync(datPath);
    return { size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

/**
 * Launch GW2 vanilla (no -autologin, no -mumble) for a one-off patcher run.
 * Mirrors the real launch path: Linux always goes through Steam/Proton; on
 * Windows/other we spawn the located Gw2-64.exe directly when it exists so a
 * non-Steam install patches correctly, falling back to Steam otherwise.
 */
function launchVanillaForPatch(installDir: string): void {
  const exePath = gw2ExePath(installDir);
  if (process.platform !== 'linux' && fs.existsSync(exePath)) {
    const child = spawn(exePath, ['-shareArchive'], {
      cwd: installDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.on('error', (spawnError) => {
      logMainError('launch', `[patch] vanilla direct-exe spawn failed: ${spawnError.message}`);
    });
    child.unref();
    return;
  }
  launchViaSteam(['-shareArchive']);
}

/**
 * After a game update, -autologin crashes with "Client needs to be patched
 * first" because it bypasses the launcher's patcher. Detect a stale Gw2.dat
 * (exe newer than dat) and, if found, run GW2 once WITHOUT -autologin so the
 * launcher patches Gw2.dat, wait for the dat to stabilize, then kill that
 * vanilla instance so the real -autologin launch can proceed cleanly.
 *
 * Returns true if a patch run was performed, false if no patch was needed.
 */
async function runPatcherIfNeeded(id: string, installDir: string): Promise<boolean> {
  const exeMtime = safeMtimeMs(gw2ExePath(installDir));
  const datMtime = safeMtimeMs(gw2DatPath(installDir));
  if (!isPatchNeeded(exeMtime, datMtime)) {
    return false;
  }

  logMain('launch', `[patch] account=${id} Gw2.dat looks stale (exe newer than dat); running patcher`);
  launchStateMachine.setState(id, 'patching', 'inferred', 'Patching GW2 after update…');

  // Vanilla launch: no -autologin, no -mumble. -shareArchive is safe and lets
  // the patcher run alongside any other instance.
  const datPath = gw2DatPath(installDir);
  const preLaunchPids = new Set(getAllRunningGw2Pids());
  launchVanillaForPatch(installDir);

  // Poll Gw2.dat to stability using the tested stepper.
  let state = createStabilityState(Date.now());
  const verdict = await new Promise<'done' | 'proceed' | 'timeout'>((resolve) => {
    const timer = setInterval(() => {
      // Honor a Stop click during patching.
      const current = launchStateMachine.getState(id);
      if (current && (current.phase === 'stopping' || current.phase === 'stopped')) {
        clearInterval(timer);
        resolve('proceed');
        return;
      }
      const sample = sampleGw2Dat(datPath);
      if (sample == null) return; // transient unreadable dat; keep polling
      const stepped = stepStability(state, sample, Date.now(), PATCH_STABILITY_CONFIG);
      state = stepped.state;
      if (stepped.verdict !== 'pending') {
        clearInterval(timer);
        resolve(stepped.verdict);
      }
    }, PATCH_POLL_INTERVAL_MS);
  });

  if (verdict === 'timeout') {
    logMainWarn('launch', `[patch] account=${id} patch timed out after ${PATCH_STABILITY_CONFIG.ceilingMs}ms`);
  } else {
    logMain('launch', `[patch] account=${id} patch ${verdict}; tearing down vanilla instance`);
  }

  // Kill the vanilla instance(s) we spawned so the real -autologin launch
  // starts from a clean slate. Only terminate pids that appeared after our
  // vanilla spawn — never an unrelated instance that predated it.
  for (const pid of getAllRunningGw2Pids()) {
    if (!preLaunchPids.has(pid)) {
      terminatePidTree(pid);
    }
  }
  // Give the OS a moment to release the GW2 mutex before the next launch.
  await new Promise((resolve) => setTimeout(resolve, PATCH_TEARDOWN_SETTLE_MS));

  return true;
}

function closeAnyExistingGw2Mutex(existingPidCount: number): MutexCloserResult {
  const helperPath = getHelperPath();
  if (!fs.existsSync(helperPath)) {
    return { ok: false, closedCount: 0, reason: `helper binary not found at ${helperPath}` };
  }
  if (process.platform === 'win32') {
    logMain('launch', `[mutex] Running mutex-closer against ${existingPidCount} existing GW2 process(es)`);
    return runMutexCloserDirect(helperPath);
  }
  if (process.platform === 'linux') {
    const home = os.homedir();
    const libraryPaths = getSteamLibraryPaths();
    // Ensure default library is checked even if libraryfolders.vdf missed it.
    const defaultLib = path.join(home, '.local', 'share', 'Steam');
    const allLibs = libraryPaths.includes(defaultLib) ? libraryPaths : [defaultLib, ...libraryPaths];
    const ctx = resolveProtonContext(
      home,
      allLibs,
      {
        existsSync: fs.existsSync,
        readFileSync: (p, enc) => fs.readFileSync(p, enc ?? 'utf-8') as string,
        readdirSync: (p) => fs.readdirSync(p) as string[],
      },
      () => {
        try {
          return spawnSync('ps', ['-eo', 'args='], { encoding: 'utf8' }).stdout || '';
        } catch {
          return '';
        }
      },
    );
    if (!ctx) {
      return { ok: false, closedCount: 0, reason: 'could not resolve a Steam Proton install for Guild Wars 2' };
    }
    logMain('launch', `[mutex] Running mutex-closer under Proton (${ctx.protonPath})`);
    return runMutexCloserUnderProton(helperPath, ctx);
  }
  return { ok: false, closedCount: 0, reason: `mutex closing not supported on platform ${process.platform}` };
}

async function waitForAccountProcess(
  accountId: string,
  timeoutMs = 25000,
  preLaunchGw2Pids?: Set<number>,
): Promise<boolean> {
  const startedAt = Date.now();
  const pollIntervalMs = process.platform === 'win32' ? 1200 : 500;
  let fallbackLogged = false;

  while (Date.now() - startedAt < timeoutMs) {
    const active = getActiveAccountProcesses();
    if (active.some((processInfo) => processInfo.accountId === accountId)) {
      return true;
    }

    // Windows fallback: if the mumble match never lands (likely because GW2
    // ran elevated and WMI hid its CommandLine), bind any *new* Gw2-64.exe
    // pid that appeared after we spawned to this account.
    if (process.platform === 'win32' && preLaunchGw2Pids) {
      const currentPids = new Set(getAllRunningGw2Pids());
      const claimedPids = new Set<number>([
        ...active.map((processInfo) => processInfo.pid),
        ...Array.from(manualAccountPidBindings.values()),
      ]);
      const newCandidates = Array.from(currentPids).filter(
        (pid) => !preLaunchGw2Pids.has(pid) && !claimedPids.has(pid),
      );
      if (newCandidates.length === 1) {
        const pidToBind = newCandidates[0];
        manualAccountPidBindings.set(accountId, pidToBind);
        logMain(
          'launch',
          `[detect] Mumble-match missed for account=${accountId}; binding new Gw2-64.exe pid=${pidToBind} ` +
          `(likely WMI elevated-process blackout). active=${active.length} currentGw2=${currentPids.size} preLaunch=${preLaunchGw2Pids.size}`,
        );
        return true;
      }
      if (!fallbackLogged && newCandidates.length > 1) {
        logMainWarn(
          'launch',
          `[detect] Found ${newCandidates.length} new Gw2-64.exe pids during detection of account=${accountId}; skipping ambiguous binding`,
        );
        fallbackLogged = true;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return false;
}

function getGw2ProcessNames(): string[] {
  const settings = store.get('settings') as { gw2Path?: string } | undefined;
  const names = new Set<string>(['Gw2-64.exe', 'Gw2.exe', 'Gw2-64']);
  const configuredPath = settings?.gw2Path?.trim();
  if (configuredPath) {
    names.add(path.basename(configuredPath));
  }
  return Array.from(names);
}

function getGw2CommandRegex(): RegExp {
  const settings = store.get('settings') as { gw2Path?: string } | undefined;
  const configuredName = settings?.gw2Path ? path.basename(settings.gw2Path) : '';
  const escapedConfiguredName = configuredName
    ? configuredName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    : '';

  return escapedConfiguredName
    ? new RegExp(`(?:^|[\\\\/\\s])(?:gw2-64(?:\\.exe)?|gw2(?:\\.exe)?|${escapedConfiguredName})(?:\\s|$)`, 'i')
    : /(?:^|[\\/\s])(?:gw2-64(?:\.exe)?|gw2(?:\.exe)?)(?:\s|$)/i;
}

function getFirstExistingPath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim();
    if (!normalized) continue;
    if (fs.existsSync(normalized)) return normalized;
  }
  return null;
}

function autoLocateGw2ExecutablePath(): { found: boolean; path?: string; message: string } {
  const settings = store.get('settings') as { gw2Path?: string } | undefined;
  const configured = settings?.gw2Path?.trim();
  if (configured && fs.existsSync(configured)) {
    return { found: true, path: configured, message: 'Using configured executable path.' };
  }

  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Guild Wars 2', 'Gw2-64.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Guild Wars 2', 'Gw2-64.exe'),
      'C:\\Guild Wars 2\\Gw2-64.exe',
      ...getSteamLibraryPaths().map((libPath) =>
        path.join(libPath, 'steamapps', 'common', 'Guild Wars 2', 'Gw2-64.exe')
      ),
    ];
    const found = getFirstExistingPath(candidates);
    if (found) return { found: true, path: found, message: 'Found Guild Wars 2 executable.' };
    return { found: false, message: 'Could not auto-locate Guild Wars 2 executable on this system.' };
  }

  if (process.platform === 'linux') {
    const whichGw2 = spawnSync('which', ['gw2'], { encoding: 'utf8' });
    if (whichGw2.status === 0) {
      const found = String(whichGw2.stdout || '').trim();
      if (found && fs.existsSync(found)) {
        return { found: true, path: found, message: 'Found gw2 launcher from PATH.' };
      }
    }
    const whichGw264 = spawnSync('which', ['gw2-64'], { encoding: 'utf8' });
    if (whichGw264.status === 0) {
      const found = String(whichGw264.stdout || '').trim();
      if (found && fs.existsSync(found)) {
        return { found: true, path: found, message: 'Found gw2-64 launcher from PATH.' };
      }
    }

    const home = os.homedir();
    const candidates = [
      path.join(home, '.steam', 'steam', 'steamapps', 'common', 'Guild Wars 2', 'Gw2-64.exe'),
      path.join(home, '.local', 'share', 'Steam', 'steamapps', 'common', 'Guild Wars 2', 'Gw2-64.exe'),
      ...getSteamLibraryPaths().map(libPath =>
        path.join(libPath, 'steamapps', 'common', 'Guild Wars 2', 'Gw2-64.exe')
      ),
      '/usr/bin/gw2',
      '/usr/local/bin/gw2',
    ];
    const found = getFirstExistingPath(candidates);
    if (found) return { found: true, path: found, message: 'Found Guild Wars 2 executable candidate.' };
    return { found: false, message: 'Could not auto-locate Guild Wars 2 executable on this system.' };
  }

  return { found: false, message: 'Auto-locate is not supported on this platform.' };
}

function getAccountMumblePids(accountId: string): number[] {
  const mumbleName = getAccountMumbleName(accountId);
  const found = new Set<number>();

  if (process.platform === 'win32') {
    const processes = getWindowsProcessSnapshot();
    for (const processInfo of processes) {
      const pid = Number(processInfo?.ProcessId);
      const commandLine = String(processInfo?.CommandLine || '');
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
      if (extractMumbleNameFromCommandLine(commandLine) !== mumbleName) continue;
      found.add(pid);
    }
    return Array.from(found);
  }

  const psResult = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  if (psResult.status !== 0 || !psResult.stdout) return [];

  const lines = psResult.stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const args = match[2];
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    if (extractMumbleNameFromCommandLine(args) !== mumbleName) continue;
    found.add(pid);
  }
  return Array.from(found);
}

function getDescendantPids(rootPid: number): number[] {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return [];
  const psResult = spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
  if (psResult.status !== 0 || !psResult.stdout) return [];

  const childrenByParent = new Map<number, number[]>();
  const lines = psResult.stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s*$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || pid <= 0 || ppid <= 0) continue;
    const list = childrenByParent.get(ppid) ?? [];
    list.push(pid);
    childrenByParent.set(ppid, list);
  }

  const found = new Set<number>();
  const queue: number[] = [rootPid];
  while (queue.length > 0) {
    const current = queue.shift() as number;
    const children = childrenByParent.get(current) ?? [];
    for (const child of children) {
      if (found.has(child)) continue;
      found.add(child);
      queue.push(child);
    }
  }

  return Array.from(found);
}

function getActiveAccountProcesses(): Array<{ accountId: string; pid: number; mumbleName: string }> {
  // @ts-ignore
  const accounts = (store.get('accounts') as any[]) || [];
  const mumbleToAccountId = new Map<string, string>();
  for (const account of accounts) {
    mumbleToAccountId.set(getAccountMumbleName(account.id), account.id);
  }
  if (mumbleToAccountId.size === 0) return [];

  const names = getGw2ProcessNames().map((name) => name.toLowerCase());
  const foundByAccount = new Map<string, { accountId: string; pid: number; mumbleName: string }>();

  if (process.platform === 'win32') {
    const processes = getWindowsProcessSnapshot();

    const livePids = new Set<number>();
    for (const processInfo of processes) {
      const imageName = String(processInfo?.Name || '').toLowerCase();
      if (!imageName || !names.includes(imageName)) continue;
      const pid = Number(processInfo?.ProcessId);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      livePids.add(pid);
      const commandLine = String(processInfo?.CommandLine || '');
      const mumbleName = extractMumbleNameFromCommandLine(commandLine);
      if (!mumbleName) continue;
      const accountId = mumbleToAccountId.get(mumbleName);
      if (!accountId) continue;
      if (!foundByAccount.has(accountId)) {
        foundByAccount.set(accountId, { accountId, pid, mumbleName });
      }
    }

    // Fallback: include manually-bound pids for accounts whose mumble match
    // failed (e.g. elevated processes whose CommandLine is hidden from WMI).
    for (const [accountId, pid] of Array.from(manualAccountPidBindings.entries())) {
      if (!livePids.has(pid)) {
        manualAccountPidBindings.delete(accountId);
        continue;
      }
      if (!foundByAccount.has(accountId)) {
        foundByAccount.set(accountId, {
          accountId,
          pid,
          mumbleName: getAccountMumbleName(accountId),
        });
      }
    }
    return Array.from(foundByAccount.values());
  }

  const psResult = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  if (psResult.status !== 0 || !psResult.stdout) return Array.from(foundByAccount.values());

  const gw2Regex = getGw2CommandRegex();

  const lines = psResult.stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const args = match[2];
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    if (!gw2Regex.test(args)) continue;
    const mumbleName = extractMumbleNameFromCommandLine(args);
    if (!mumbleName) continue;
    const accountId = mumbleToAccountId.get(mumbleName);
    if (!accountId) continue;
    if (!foundByAccount.has(accountId)) {
      foundByAccount.set(accountId, { accountId, pid, mumbleName });
    }
  }
  return Array.from(foundByAccount.values());
}

function getRunningGw2Pids(): number[] {
  return getActiveAccountProcesses().map((processInfo) => processInfo.pid);
}

function getAllRunningGw2Pids(): number[] {
  const names = new Set(getGw2ProcessNames().map((name) => name.toLowerCase()));
  const gw2Regex = getGw2CommandRegex();
  const broadGw2Regex = /(gw2-64(?:\.exe)?|gw2(?:\.exe)?|guild wars 2)/i;
  const wineProcessRegex = /\b(wine|wine64|wine64-preloader|proton|wineserver)\b/i;
  const found = new Set<number>();

  if (process.platform === 'win32') {
    const processes = getWindowsProcessSnapshot();
    for (const processInfo of processes) {
      const imageName = String(processInfo?.Name || '').toLowerCase();
      const commandLine = String(processInfo?.CommandLine || '');
      const matchesCommand = gw2Regex.test(commandLine);
      if (!matchesCommand && !names.has(imageName)) continue;
      const pid = Number(processInfo?.ProcessId);
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
      found.add(pid);
    }
    return Array.from(found);
  }

  const psResult = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  if (psResult.status !== 0 || !psResult.stdout) return [];

  const lines = psResult.stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const args = String(match[2] || '');
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    const directMatch = gw2Regex.test(args);
    const wineBroadMatch = wineProcessRegex.test(args) && broadGw2Regex.test(args);
    if (!directMatch && !wineBroadMatch) continue;
    found.add(pid);
  }
  return Array.from(found);
}

function terminatePid(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' });
      if (result.status === 0) {
        invalidateWindowsProcessSnapshot();
        return true;
      }
      invalidateWindowsProcessSnapshot();
      if (!isWindowsPidRunning(pid)) {
        logMainWarn('stop', `taskkill returned status=${result.status ?? 'null'} but pid=${pid} is not running`);
        return true;
      }
      return false;
    }
    process.kill(pid, 'SIGTERM');
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already exited or no permission.
    }
    return true;
  } catch {
    return false;
  }
}

function terminatePidTree(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform === 'win32') return terminatePid(pid);

  const descendants = getDescendantPids(pid);
  const ordered = [...descendants, pid];

  let terminatedAny = false;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    if (terminatePid(ordered[i])) {
      terminatedAny = true;
    }
  }
  return terminatedAny;
}

function stopRunningGw2Processes(): boolean {
  const pids = getAllRunningGw2Pids();
  if (pids.length === 0) return false;

  let stoppedAny = false;
  for (const pid of pids) {
    if (terminatePid(pid)) stoppedAny = true;
  }
  return stoppedAny;
}

function stopAccountProcess(accountId: string): boolean {
  manualAccountPidBindings.delete(accountId);
  launchStateMachine.setState(accountId, 'stopping', 'verified', 'Stop requested');
  const mappedPids = getActiveAccountProcesses()
    .filter((processInfo) => processInfo.accountId === accountId)
    .map((processInfo) => processInfo.pid);
  const mumblePids = getAccountMumblePids(accountId);
  const targetPids = Array.from(new Set([...mappedPids, ...mumblePids]));

  if (targetPids.length > 0) {
    logMain('stop', `Account=${accountId} target pids=${targetPids.join(',')}`);
    let stoppedAny = false;
    for (const pid of targetPids) {
      if (terminatePidTree(pid)) stoppedAny = true;
    }
    invalidateWindowsProcessSnapshot();
    const remaining = getAccountMumblePids(accountId);
    if (stoppedAny && remaining.length === 0) {
      launchStateMachine.setState(accountId, 'stopped', 'verified', `Killed account-bound PIDs: ${targetPids.join(', ')}`);
      return true;
    }
  }

  invalidateWindowsProcessSnapshot();
  const running = getAllRunningGw2Pids();
  logMain('stop', `Account=${accountId} fallback running pids=${running.join(',')}`);
  if (running.length === 0) {
    launchStateMachine.setState(accountId, 'stopped', 'inferred', 'No running GW2 process found');
    return true;
  }
  let stoppedAny = false;
  for (const pid of running) {
    if (terminatePidTree(pid)) stoppedAny = true;
  }
  invalidateWindowsProcessSnapshot();
  const stillRunning = getAllRunningGw2Pids();
  if (stillRunning.length === 0) {
    launchStateMachine.setState(accountId, 'stopped', 'inferred', 'No running GW2 process found after stop attempts');
    return true;
  }
  if (stoppedAny) {
    launchStateMachine.setState(accountId, 'stopped', 'verified', `Stopped via fallback PID kill (${running.join(', ')})`);
    return true;
  }
  launchStateMachine.setState(accountId, 'errored', 'verified', 'Stop failed: account process could not be identified');
  return false;
}

function shouldPromptMasterPassword(): boolean {
  const settings = store.get('settings') as { masterPasswordPrompt?: 'every_time' | 'daily' | 'weekly' | 'monthly' | 'never' } | undefined;
  const mode = settings?.masterPasswordPrompt ?? 'every_time';
  const intervals: Record<'daily' | 'weekly' | 'monthly', number> = {
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000,
  };
  const lastUnlockAt = Number(store.get('security_v2.lastUnlockAt') || 0);
  const hasValidLastUnlock = Number.isFinite(lastUnlockAt) && lastUnlockAt > 0;
  const now = Date.now();
  const elapsed = hasValidLastUnlock ? (now - lastUnlockAt) : Number.POSITIVE_INFINITY;
  const cadenceExpired = mode in intervals
    ? elapsed >= intervals[mode as 'daily' | 'weekly' | 'monthly']
    : true;

  if (!masterKey && mode !== 'every_time') {
    const cachedValue = String(store.get('security_v2.cachedMasterKey') || '');
    if (cachedValue) {
      const restored = decryptFromStorage(cachedValue);
      if (restored && restored.length > 0) {
        if (mode === 'never') {
          masterKey = restored;
          return false;
        }
        if (hasValidLastUnlock && !cadenceExpired) {
          masterKey = restored;
          return false;
        }
      }
    }
  }

  // Without an in-memory key, account operations requiring decryption cannot proceed.
  if (!masterKey) return true;

  // If we have a masterKey in memory, the user is already authenticated in this session.
  // For 'never' and 'every_time' modes, don't prompt again until app restart.
  if (mode === 'never' || mode === 'every_time') return false;

  if (mode in intervals) {
    return cadenceExpired;
  }
  return true;
}

const createWindow = () => {
  const appIconPath = app.isPackaged
    ? path.join(__dirname, '../dist/img/AxiAM-square.png')
    : path.join(process.cwd(), 'public/img/AxiAM-square.png');
  const storedWindowState = getStoredWindowState();

  mainWindow = new BrowserWindow({
    width: storedWindowState.width,
    height: storedWindowState.height,
    x: storedWindowState.x,
    y: storedWindowState.y,
    frame: false,
    ...(process.platform === 'darwin'
      ? { transparent: false }
      : { transparent: true, backgroundColor: '#00000000' }),
    icon: appIconPath,
    // titleBarStyle: 'hidden',
    resizable: true, // Allow resize but keep default small
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-change', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-change', false);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    console.log("Loading URL:", process.env.VITE_DEV_SERVER_URL);
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // mainWindow.webContents.openDevTools();
  } else {
    console.log("Loading URL: dist/index.html (Production)");
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('resize', () => persistWindowState());
  mainWindow.on('move', () => persistWindowState());
  mainWindow.on('maximize', () => persistWindowState());
  mainWindow.on('unmaximize', () => persistWindowState());
  mainWindow.on('close', () => persistWindowState(true));

  if (storedWindowState.isMaximized) {
    mainWindow.maximize();
  }
};

app.on('ready', () => {
  // Migrate legacy per-account Local.dat snapshots into the per-profile layout
  // introduced in v1.1.14. Idempotent — re-runs at every startup but only acts
  // when there's actual legacy state to move.
  try {
    // @ts-ignore
    const accountsForMigration = (store.get('accounts') as Array<{ id: string }> | undefined) || [];
    const migrationResult = migrateLegacyLocalDat(
      {
        userDataDir: app.getPath('userData'),
        accountIds: accountsForMigration.map((a) => a.id),
      },
      {
        existsSync: fs.existsSync,
        mkdirSync: (p, opts) => fs.mkdirSync(p, opts),
        renameSync: (from, to) => fs.renameSync(from, to),
        readdirSync: (p) => fs.readdirSync(p) as string[],
        rmdirSync: (p) => fs.rmdirSync(p),
      },
    );
    if (migrationResult.migratedAccountIds.length > 0) {
      logMain('startup', `[migration:profiles] moved Local.dat for accounts=${migrationResult.migratedAccountIds.join(',')}`);
    }
    if (migrationResult.legacyDirRemoved) {
      logMain('startup', `[migration:profiles] removed empty legacy local-dat directory`);
    }
    if (migrationResult.orphanedFilesLeft > 0) {
      logMainWarn('startup', `[migration:profiles] legacy local-dat directory contained ${migrationResult.orphanedFilesLeft} orphaned files; left untouched`);
    }
    for (const err of migrationResult.errors) {
      logMainError('startup', `[migration:profiles] account=${err.accountId} failed: ${err.reason}`);
    }
  } catch (err: any) {
    logMainError('startup', `[migration:profiles] unexpected error: ${err?.message ?? err}`);
  }

  // Junction migration (Windows + opt-in flag). Idempotent: subsequent runs
  // detect the existing junction and no-op. Refuses to migrate while GW2 is
  // running so we don't yank a directory out from under live file handles.
  //
  // The DLL-redirect flag takes precedence: if it's on we un-migrate the
  // junction (or no-op if there isn't one) so the host appdata path is a
  // real directory again. The DLL-redirect strategy needs a shared real
  // directory at hostPath because the launcher's update check coordinates
  // across all instances through it.
  if (process.platform === 'win32') {
    const settings = (store.get('settings') as AppSettings | undefined) || {} as AppSettings;
    const appData = process.env.APPDATA;
    if (settings.allowMultiInstance) {
      if (!appData) {
        logMainWarn('startup', '[dll-redirect] APPDATA env var missing; cannot un-migrate junction');
      } else {
        const hostPath = path.join(appData, 'Guild Wars 2');
        const defaultProfileDir = path.join(
          app.getPath('userData'),
          'default-gw2-state',
          'Guild Wars 2',
        );
        try {
          const result = unmigrateJunctionToRealDir({
            hostPath,
            defaultProfileDir,
            isGw2Running: () => getAllRunningGw2Pids().length > 0,
          });
          logMain('startup', `[dll-redirect] un-junction: ${result.status} (${result.movedFiles} files)`);
          if (result.status === 'refused-gw2-running' && mainWindow) {
            mainWindow.webContents.send('junction-migration-deferred');
          }
        } catch (err: any) {
          logMainError('startup', `[dll-redirect] un-junction failed: ${err?.message ?? err}`);
        }
      }
    } else if (settings.junctionMultiInstance) {
      if (!appData) {
        logMainWarn('startup', '[junction] APPDATA env var missing; cannot migrate');
      } else {
        const hostPath = path.join(appData, 'Guild Wars 2');
        const defaultProfileDir = path.join(
          app.getPath('userData'),
          'default-gw2-state',
          'Guild Wars 2',
        );
        try {
          const result = migrateGw2DirToJunction({
            hostPath,
            defaultProfileDir,
            isGw2Running: () => getAllRunningGw2Pids().length > 0,
          });
          logMain('startup', `[junction] migration: ${result.status} (${result.movedFiles} files)`);
          if (result.status === 'refused-gw2-running' && mainWindow) {
            mainWindow.webContents.send('junction-migration-deferred');
          }
        } catch (err: any) {
          logMainError('startup', `[junction] migration failed: ${err?.message ?? err}`);
        }
      }
    }
  }

  // Configure and start the quit watcher (Windows only). When a tracked GW2
  // PID disappears AND no other GW2 is running, we snapshot the host Local.dat
  // back into the account's profile dir to preserve per-account settings.
  quitWatcher.configure(() => getAllRunningGw2Pids(), QUIT_WATCHER_POLL_INTERVAL_MS);
  quitWatcher.on('quit', (accountId: string) => {
    const ctx = launchContexts.get(accountId);
    launchContexts.delete(accountId);

    // Reset the state machine ONLY if the current phase reflects a
    // run that already reached the running state. Without this the UI
    // keeps showing the running / errored phase from the prior launch
    // until the user clicks Launch again — confusing when diagnosing
    // failures. Guard against clobbering a freshly-queued relaunch by
    // not overwriting launch_requested / launcher_started.
    const currentPhase = launchStateMachine.getState(accountId)?.phase;
    if (currentPhase === 'running' || currentPhase === 'process_detected' || currentPhase === 'errored') {
      launchStateMachine.setState(accountId, 'stopped', 'verified', 'Process exited');
    }

    // DLL-redirect mode (implicit under allowMultiInstance on Windows):
    // GW2's every Local.dat open was rewritten to the per-account file
    // in-process, so the host file never held this account's data.
    // Nothing to copy back.
    const settings = (store.get('settings') as AppSettings | undefined) || {} as AppSettings;
    if (process.platform === 'win32' && settings.allowMultiInstance) {
      logMain('snapshot', `[dll-redirect] account=${accountId} quit; state already written in-place to profile`);
      return;
    }
    // Junction mode: GW2 wrote in place into the account's profile dir via
    // the repointed junction, so there's nothing to snapshot back.
    if (settings.junctionMultiInstance) {
      logMain('snapshot', `[junction] account=${accountId} quit; state already persisted in-place`);
      return;
    }

    const remaining = getAllRunningGw2Pids();
    if (remaining.length > 0) {
      logMain('snapshot', `[snapshot] account=${accountId} quit but ${remaining.length} other GW2 still running; skipping copy-back to avoid cross-contamination`);
      return;
    }

    // Fresh account (no snapshot existed at launch, so no install ran). Host
    // could hold any prior account's data; only save if the user stayed long
    // enough to plausibly have authenticated.
    if (ctx && !ctx.installed) {
      const elapsedMs = Date.now() - ctx.startedAtMs;
      if (elapsedMs < FRESH_LAUNCH_MIN_SAVE_MS) {
        logMain('snapshot', `[snapshot] account=${accountId} skipped: fresh-account quit after ${elapsedMs}ms (<${FRESH_LAUNCH_MIN_SAVE_MS}ms threshold) — likely no authentication happened`);
        return;
      }
    }

    const result = snapshotHostToAccount(accountId);
    if (result.ok) {
      logMain('snapshot', `[snapshot] account=${accountId} copied Local.dat host → profile`);
    } else {
      logMainWarn('snapshot', `[snapshot] account=${accountId} skipped: ${result.reason}`);
    }
  });
  quitWatcher.start();

  console.log("User Data Path:", app.getPath('userData'));
  fs.writeFileSync(path.join(app.getPath('userData'), 'axiom-version'), app.getVersion(), 'utf8');
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.axiam.app');
  }
  createWindow();

  const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
  const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE);
  autoUpdateEnabled = app.isPackaged && !isPortable && fs.existsSync(updateConfigPath);
  if (!autoUpdateEnabled) {
    log.info('[AutoUpdater] Disabled: no app-update.yml, unpackaged app, or portable build.');
    if (isDevFakeUpdate) {
      log.info('[AutoUpdater] Dev fake updater mode enabled.');
      setTimeout(() => {
        void checkForUpdates('startup');
      }, 1800);
    }
  } else {
    setupAutoUpdater();
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    setTimeout(() => {
      void checkForUpdates('startup');
    }, 3000);
  }
});

app.on('before-quit', () => {
  quitWatcher.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Window Controls
ipcMain.on('minimize-window', () => {
  console.log('Main: minimize-window received');
  mainWindow?.minimize();
});
ipcMain.on('maximize-window', () => {
  console.log('Main: maximize-window received');
  if (mainWindow?.isMaximized()) mainWindow?.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('close-window', () => {
  console.log('Main: close-window received');
  mainWindow?.close();
});

ipcMain.on('reset-app', () => {
  store.clear();
  app.relaunch();
  app.exit();
});

ipcMain.on('check-for-updates', () => {
  void checkForUpdates('manual');
});

ipcMain.on('restart-app', () => {
  if (isDevFakeUpdate || !app.isPackaged) {
    app.relaunch();
    app.exit(0);
    return;
  }
  autoUpdater.quitAndInstall();
});

ipcMain.handle('get-app-version', async () => {
  return app.getVersion();
});

ipcMain.handle('get-whats-new', async () => {
  const version = app.getVersion();
  if (isDevFakeWhatsNew) {
    return {
      version,
      releaseNotes: `# Release Notes\n\nVersion v${version}\n\n## 🌟 Highlights\n- Fake update mode is active for local UI testing.\n\n## 🛠️ Improvements\n- Added a simulated updater flow (checking, downloading, restart).\n\n## 🧯 Fixes\n- What\'s New can now be previewed without publishing a GitHub release.\n\n## ⚠️ Breaking Changes\n- None.`,
    };
  }
  const tag = `v${version}`;
  const releaseUrl = `https://api.github.com/repos/darkharasho/axiam/releases/tags/${tag}`;

  try {
    const resp = await fetch(releaseUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'AxiAM-Updater',
      },
    });
    if (resp.ok) {
      const data = await resp.json() as { body?: string };
      const body = String(data?.body || '').trim();
      if (body) {
        return { version, releaseNotes: body };
      }
    }
  } catch {
    // Fall back to local release notes if GitHub is unavailable.
  }

  try {
    const basePath = app.isPackaged ? process.resourcesPath : process.cwd();
    const notesPath = path.join(basePath, 'RELEASE_NOTES.md');
    const releaseNotes = fs.readFileSync(notesPath, 'utf8').trim();
    return { version, releaseNotes: releaseNotes || `Release notes unavailable for ${tag}.` };
  } catch {
    return { version, releaseNotes: `Release notes unavailable for ${tag}.` };
  }
});

ipcMain.handle('should-show-whats-new', async () => {
  const version = app.getVersion();
  if (isDevFakeWhatsNew) {
    return { version, shouldShow: true };
  }
  const lastSeenVersion = String(store.get('lastSeenVersion', '') || '');
  return { version, shouldShow: lastSeenVersion !== version };
});

ipcMain.handle('set-last-seen-version', async (_event, version: string) => {
  store.set('lastSeenVersion', String(version || '').trim());
  return true;
});

ipcMain.handle('open-external', async (_event, url: string) => {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) return false;
  try {
    await shell.openExternal(target);
    return true;
  } catch (error) {
    logMainWarn('external', `shell.openExternal failed for ${target}: ${error instanceof Error ? error.message : String(error)}`);
    if (process.platform === 'linux') {
      try {
        const child = spawn('xdg-open', [target], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        return true;
      } catch (fallbackError) {
        logMainError('external', `xdg-open fallback failed for ${target}: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
      }
    }
    return false;
  }
});

ipcMain.handle('export-diagnostics', async () => {
  return exportDiagnosticsBundle();
});


ipcMain.handle('has-local-dat', async (_, accountId: string) => {
  return hasLocalDat(accountId);
});

ipcMain.handle('delete-local-dat', async (_, accountId: string) => {
  deleteLocalDat(accountId);
  return true;
});

// Security & Account Management
ipcMain.handle('has-master-password', async () => {
  if (isDevShowcase) return true;
  return !!store.get('security_v2.salt');
});

ipcMain.handle('set-master-password', async (_, password) => {
  const salt = generateSalt();
  const key = deriveKey(password, Buffer.from(salt, 'hex'));
  const validationHash = crypto.createHash('sha256').update(key).digest('hex');

  store.set('security_v2.salt', salt);
  store.set('security_v2.validationHash', validationHash);
  store.set('security_v2.lastUnlockAt', Date.now());
  const settings = store.get('settings') as { masterPasswordPrompt?: 'every_time' | 'daily' | 'weekly' | 'monthly' | 'never' } | undefined;
  if ((settings?.masterPasswordPrompt ?? 'every_time') !== 'every_time') {
    store.set('security_v2.cachedMasterKey', encryptForStorage(key));
  } else {
    store.set('security_v2.cachedMasterKey', '');
  }
  masterKey = key;
  return true;
});

ipcMain.handle('verify-master-password', async (_, password) => {
  if (isDevShowcase) return true;
  const salt = store.get('security_v2.salt');
  const storedHash = store.get('security_v2.validationHash');

  if (!salt || !storedHash) return false;

  // Cast salt to string because electron-store types might be inferred loosely
  const saltBuffer = Buffer.from(salt as string, 'hex');
  const key = deriveKey(password, saltBuffer);
  const hash = crypto.createHash('sha256').update(key).digest('hex');

  if (hash === storedHash) {
    masterKey = key;
    store.set('security_v2.lastUnlockAt', Date.now());
    const settings = store.get('settings') as { masterPasswordPrompt?: 'every_time' | 'daily' | 'weekly' | 'monthly' | 'never' } | undefined;
    if ((settings?.masterPasswordPrompt ?? 'every_time') !== 'every_time') {
      store.set('security_v2.cachedMasterKey', encryptForStorage(key));
    } else {
      store.set('security_v2.cachedMasterKey', '');
    }
    return true;
  }
  return false;
});

ipcMain.handle('should-prompt-master-password', async () => {
  if (isDevShowcase) return false;
  return shouldPromptMasterPassword();
});

ipcMain.handle('save-account', async (_, accountData) => {
  if (!masterKey) throw new Error('Master key not set');
  const rawPassword = accountData.passwordEncrypted;
  const encryptedPassword = encrypt(rawPassword, masterKey);

  const id = crypto.randomUUID();
  const newAccount = {
    id,
    nickname: accountData.nickname,
    email: accountData.email,
    passwordEncrypted: encryptedPassword,
    launchArguments: accountData.launchArguments,
    apiKey: accountData.apiKey ?? '',
    apiAccountName: '',
    apiCreatedAt: '',
  };

  // @ts-ignore
  const accounts = (store.get('accounts') as any[]) || [];
  store.set('accounts', [...accounts, newAccount]);
  logMain('launch', `Saved account id=${id}`);
  return true;
});

ipcMain.handle('is-gw2-running', async () => {
  if (isDevShowcase) return showcaseActiveAccounts.size > 0;
  return getRunningGw2Pids().length > 0;
});

ipcMain.handle('stop-gw2-process', async () => {
  if (isDevShowcase) {
    showcaseActiveAccounts.clear();
    return true;
  }
  return stopRunningGw2Processes();
});

ipcMain.handle('get-active-account-processes', async () => {
  if (isDevShowcase) {
    return showcaseAccounts
      .filter((account) => showcaseActiveAccounts.has(account.id))
      .map((account, index) => ({
        accountId: account.id,
        pid: 41000 + index,
        mumbleName: getAccountMumbleName(account.id),
      }));
  }
  return getActiveAccountProcesses();
});

ipcMain.handle('get-launch-states', async () => {
  if (isDevShowcase) {
    return showcaseAccounts.map((account) => ({
      accountId: account.id,
      phase: showcaseActiveAccounts.has(account.id) ? 'running' : 'idle',
      certainty: 'verified' as const,
      updatedAt: Date.now(),
      note: showcaseActiveAccounts.has(account.id) ? 'Showcase running state' : 'Showcase idle state',
    }));
  }
  return launchStateMachine.getAllStates();
});



ipcMain.handle('stop-account-process', async (_, accountId) => {
  if (isDevShowcase) {
    showcaseActiveAccounts.delete(String(accountId));
    return true;
  }
  quitWatcher.noteStop(accountId);
  return stopAccountProcess(accountId);
});

ipcMain.handle('resolve-account-profile', async (_, apiKey) => {
  if (isDevShowcase) {
    const lookup = showcaseAccounts.find((account) => account.apiKey === String(apiKey || '').trim());
    return {
      name: lookup?.apiAccountName || 'ShowcaseAccount.0000',
      created: lookup?.apiCreatedAt || '2020-01-01T00:00:00Z',
    };
  }
  const token = String(apiKey || '').trim();
  if (!token) return { name: '', created: '' };
  try {
    const accountResponse = await fetch('https://api.guildwars2.com/v2/account', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!accountResponse.ok) return { name: '', created: '' };
    const accountData = await accountResponse.json() as { name?: string; created?: string };
    return {
      name: typeof accountData?.name === 'string' ? accountData.name.trim() : '',
      created: typeof accountData?.created === 'string' ? accountData.created.trim() : '',
    };
  } catch {
    return { name: '', created: '' };
  }
});

ipcMain.handle('set-account-api-profile', async (_, id, profile) => {
  // @ts-ignore
  const accounts = (store.get('accounts') as any[]) || [];
  const index = accounts.findIndex((a: any) => a.id === id);
  if (index < 0) return false;
  accounts[index] = {
    ...accounts[index],
    apiAccountName: String(profile?.name || '').trim(),
    apiCreatedAt: String(profile?.created || '').trim(),
  };
  store.set('accounts', accounts);
  return true;
});

ipcMain.handle('update-account', async (_, id, accountData) => {
  if (!masterKey) throw new Error('Master key not set');

  // @ts-ignore
  const accounts = (store.get('accounts') as any[]) || [];
  const index = accounts.findIndex((a: any) => a.id === id);
  if (index < 0) return false;

  const existing = accounts[index];
  const passwordEncrypted = accountData.passwordEncrypted
    ? encrypt(accountData.passwordEncrypted, masterKey)
    : existing.passwordEncrypted;
  const nextApiKey = accountData.apiKey ?? existing.apiKey ?? '';
  const existingApiKey = existing.apiKey ?? '';

  accounts[index] = {
    ...existing,
    nickname: accountData.nickname,
    email: accountData.email,
    passwordEncrypted,
    launchArguments: accountData.launchArguments ?? existing.launchArguments ?? '',
    apiKey: nextApiKey,
    apiAccountName: nextApiKey === existingApiKey ? (existing.apiAccountName ?? '') : '',
    apiCreatedAt: nextApiKey === existingApiKey ? (existing.apiCreatedAt ?? '') : '',
  };

  store.set('accounts', accounts);
  return true;
});

ipcMain.handle('get-accounts', async () => {
  if (isDevShowcase) {
    return showcaseAccounts;
  }
  if (!masterKey) throw new Error('Master key not set');
  return store.get('accounts') || [];
});

ipcMain.handle('delete-account', async (_, id) => {
  // @ts-ignore
  const accounts = (store.get('accounts') as any[]) || [];
  const newAccounts = accounts.filter((a: any) => a.id !== id);
  store.set('accounts', newAccounts);
  launchStateMachine.clearState(id);
  try {
    deleteLocalDat(id);
  } catch (err: any) {
    logMainWarn('delete-account', `Failed to clean up profile dir for account=${id}: ${err?.message ?? err}`);
  }
  return true;
});

async function installSnapshotToHostWithRetry(
  accountId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const start = Date.now();
  let lastResult = installSnapshotToHost(accountId);
  while (!lastResult.ok && Date.now() - start < INSTALL_RETRY_TOTAL_MS) {
    if (lastResult.reason === 'no-snapshot') return lastResult;
    await new Promise((resolve) => setTimeout(resolve, INSTALL_RETRY_INTERVAL_MS));
    lastResult = installSnapshotToHost(accountId);
  }
  return lastResult;
}

async function doLaunch(id: string): Promise<boolean> {
  if (isDevShowcase) {
    showcaseActiveAccounts.clear();
    showcaseActiveAccounts.add(String(id));
    return true;
  }
  if (!masterKey) throw new Error('Master key not set');

  manualAccountPidBindings.delete(id);
  launchStateMachine.setState(id, 'launch_requested', 'verified', 'Launch requested');

  // @ts-ignore
  const accounts = (store.get('accounts') as any[]) || [];
  const account = accounts.find((a: any) => a.id === id);
  if (!account) {
    logMainError('launch', `Account not found for id=${id}`);
    return false;
  }

  const launchSettings = (store.get('settings') as { gw2Path?: string; allowMultiInstance?: boolean; junctionMultiInstance?: boolean } | undefined) || {};
  let gw2Path = launchSettings?.gw2Path?.trim();
  // Multi-instance implies per-account DLL redirect on Windows. The
  // DLL redirect is the only strategy that actually delivers
  // concurrent multi-launch — take-2 and take-3 both fail with
  // "Download failed (5)" on the second client — so tying the two
  // together removes a foot-gun: no way to enable multi-instance and
  // unwittingly stay on the broken path.
  const useDllRedirect = process.platform === 'win32' && launchSettings.allowMultiInstance === true;
  const useJunction = process.platform === 'win32' && launchSettings.junctionMultiInstance === true && !useDllRedirect;

  if (gw2Path && !fs.existsSync(gw2Path)) {
    console.error(`GW2 path does not exist: ${gw2Path}`);
    logMainError('launch', `GW2 path does not exist for account=${id}: ${gw2Path}`);
    launchStateMachine.setState(id, 'errored', 'verified', 'GW2 path missing');
    return false;
  }

  // On Windows, prefer direct-executable launch so -shareArchive works across
  // multiple instances (Steam single-instances the game, blocking concurrent launches).
  if (!gw2Path && process.platform === 'win32') {
    const located = autoLocateGw2ExecutablePath();
    if (located.found && located.path) {
      gw2Path = located.path;
      logMain('launch', `[auto-locate] Using ${gw2Path} for direct launch`);
    }
  }

  // Multi-instance gate + mutex preparation.
  const existingGw2Pids = getAllRunningGw2Pids();
  if (existingGw2Pids.length > 0) {
    if (!launchSettings.allowMultiInstance) {
      logMainWarn('launch', `[mutex] Blocking launch of account=${id}: another GW2 instance is running and allowMultiInstance is off`);
      launchStateMachine.setState(
        id,
        'errored',
        'verified',
        'Another GW2 instance is running. Enable "Allow multiple GW2 instances" in Settings to launch alongside it.',
      );
      return false;
    }
    const mutexResult = closeAnyExistingGw2Mutex(existingGw2Pids.length);
    if (!mutexResult.ok) {
      logMainError('launch', `[mutex] ${mutexResult.reason}`);
      launchStateMachine.setState(
        id,
        'errored',
        'verified',
        `Couldn't prepare GW2 for multi-instance launch: ${mutexResult.reason}`,
      );
      return false;
    }
    logMain('launch', `[mutex] Closed AN-Mutex on ${mutexResult.closedCount} existing GW2 process(es)`);

    // Give the already-running instance time to finish its patcher / update
    // check before spawning ours. Without this wait the second instance hits
    // "Download failed (5)" on the splash screen because both clients race
    // ArenaNet's update endpoint.
    if (process.platform === 'win32') {
      logMain('launch', `[multi-instance] account=${id} waiting ${LAUNCH_DWELL_MULTI_INSTANCE_MS}ms for prior GW2 to settle before spawning`);
      await new Promise((resolve) => setTimeout(resolve, LAUNCH_DWELL_MULTI_INSTANCE_MS));
    }
  }

  const extraArgs = splitLaunchArguments(account.launchArguments);
  const sanitizedExtraArgs = stripManagedLaunchArguments(extraArgs);
  const mumbleName = getAccountMumbleName(account.id);

  // Per-account autologin: install the account's Local.dat at the host path
  // (or re-point the junction at the account's profile dir under junction
  // mode) before spawn so GW2 reads this account's saved credentials.
  //
  // Under dllRedirectMultiInstance, no host-path manipulation is needed:
  // the injected DLL rewrites every NtCreateFile of Local.dat to the
  // per-account file directly. The profile dir still needs to exist (so
  // the DLL has somewhere to write to on first save) but otherwise this
  // whole block is a no-op for the redirect mode.
  let useAutologin = hasLocalDat(account.id);
  if (useDllRedirect) {
    const profileDir = path.dirname(getAccountLocalDatPath(account.id));
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }
    // Seed the per-account Local.dat from the host file if this account
    // is new. Local.dat carries ~70MB of patcher cache in addition to
    // credentials — without that cache the launcher refuses to progress.
    const seedResult = seedAccountLocalDatFromHost(account.id);
    if (seedResult.ok) {
      // hasLocalDat() was evaluated above against the snapshot path; if
      // we just seeded a copy of the host file the redirect target now
      // contains creds (possibly another account's, but valid). -autologin
      // will pre-fill those; the user re-logs once and they get overwritten.
      useAutologin = true;
      logMain('launch', `[dll-redirect] account=${id} seeded profile Local.dat from host; redirect armed`);
    } else {
      logMainWarn('launch', `[dll-redirect] account=${id} seed skipped (${seedResult.reason}); launcher may need to rebuild its cache`);
    }
  } else if (useJunction) {
    const appData = process.env.APPDATA;
    const hostPath = appData ? path.join(appData, 'Guild Wars 2') : null;
    const profileDir = path.join(
      app.getPath('userData'),
      'profiles',
      account.id,
      'Guild Wars 2',
    );
    if (!hostPath) {
      logMainWarn('launch', `[junction] account=${id} APPDATA missing; launching without -autologin`);
      useAutologin = false;
    } else {
      if (!fs.existsSync(profileDir)) {
        // Fresh account: create the profile dir so the junction has somewhere
        // to point. GW2 will create Local.dat on first save.
        fs.mkdirSync(profileDir, { recursive: true });
      }
      try {
        repointJunction(hostPath, profileDir);
        logMain('launch', `[junction] account=${id} repointed → ${profileDir}`);
      } catch (err: any) {
        logMainError('launch', `[junction] account=${id} repoint failed: ${err?.message ?? err}; launching without -autologin`);
        useAutologin = false;
      }
    }
  } else if (useAutologin && process.platform === 'win32') {
    const installResult = await installSnapshotToHostWithRetry(account.id);
    if (installResult.ok) {
      logMain('launch', `[install] account=${id} installed snapshot to host path`);
    } else if (installResult.reason === 'no-snapshot') {
      // Shouldn't happen — hasLocalDat returned true. Defensive log.
      logMainWarn('launch', `[install] account=${id} unexpected no-snapshot after hasLocalDat=true`);
      useAutologin = false;
    } else {
      logMainWarn('launch', `[install] account=${id} retry exhausted (${installResult.reason}); launching without -autologin`);
      useAutologin = false;
    }
  } else if (useAutologin) {
    // Linux/other platforms: -autologin still gated on hasLocalDat but no host
    // install happens. The Linux launch goes through Steam/Proton.
    logMain('launch', `[local-dat] Saved login present for account=${id}, using -autologin`);
  } else {
    logMain('launch', `[local-dat] No saved login for account=${id}, launching without -autologin`);
  }

  // After a game update, -autologin crashes ("Client needs to be patched
  // first"). If we're about to use -autologin, make sure Gw2.dat is current
  // first — running the vanilla patcher once if it isn't.
  if (useAutologin) {
    const installDir = resolveGw2InstallDir(gw2Path);
    if (installDir) {
      try {
        await runPatcherIfNeeded(id, installDir);
      } catch (err: any) {
        logMainWarn('launch', `[patch] account=${id} patch check failed: ${err?.message ?? err}; continuing to launch`);
      }
    }
  }

  // If the user clicked Stop while we were patching, abort before spawning
  // the real -autologin instance — the patch step already tore down the
  // vanilla launcher.
  const postPatchState = launchStateMachine.getState(id);
  if (postPatchState && (postPatchState.phase === 'stopping' || postPatchState.phase === 'stopped')) {
    logMain('launch', `[patch] account=${id} launch aborted: Stop requested during patching`);
    return false;
  }

  // Always pass -shareArchive so concurrent instances can both open the
  // shared game data archive (Gw2.dat) in the install directory. Safe for
  // single-instance launches too. Skipped if the user already supplied it
  // via their per-account launchArguments (sanitizedExtraArgs).
  const userExtras = sanitizedExtraArgs;
  const hasShareArchive = userExtras.some((a) => a.toLowerCase() === '-sharearchive');
  const args = [
    '-mumble', mumbleName,
    ...(useAutologin ? ['-autologin'] : []),
    ...(hasShareArchive ? [] : ['-shareArchive']),
    ...userExtras,
  ];

  // Remember whether install populated the host with this account's data
  // and when the launch started. The quit handler uses both to decide
  // whether snapshotting host → profile is safe.
  if (process.platform === 'win32') {
    launchContexts.set(id, {
      installed: useAutologin,
      startedAtMs: Date.now(),
    });
  }

  // Snapshot existing GW2 pids before launch so we can attribute any new
  // pid to this account when WMI hides the elevated process's command line.
  const preLaunchGw2Pids = process.platform === 'win32'
    ? new Set(getAllRunningGw2Pids())
    : undefined;
  if (preLaunchGw2Pids) {
    logMain('launch', `[detect] preLaunch snapshot for account=${id}: ${preLaunchGw2Pids.size} existing Gw2 pids`);
  }

  try {
    // On Linux, always launch via Steam so Proton handles the Windows executable
    // correctly (DXVK, DLL overrides for addons like ArcDPS/Nexus, etc.)
    if (gw2Path && process.platform !== 'linux' && useDllRedirect) {
      // Inject-and-spawn path. The injector returns the child PID
      // synchronously, so we pre-bind it to the account ID — that means
      // waitForAccountProcess finds the binding immediately instead of
      // having to discover it via WMI / mumble link.
      const gw2WorkingDirectory = path.dirname(gw2Path);
      const localDatPath = getAccountLocalDatPath(account.id);
      logMain('launch', `Launching account=${id} via DLL-injected direct executable with ${args.length} args`);
      const injectResult = injectDll({
        exe: gw2Path,
        cwd: gw2WorkingDirectory,
        localDat: localDatPath,
        childArgs: args,
      });
      if (!injectResult.ok || typeof injectResult.pid !== 'number') {
        logMainError('launch', `[dll-redirect] inject failed for account=${id}: ${injectResult.reason ?? 'unknown'}`);
        launchStateMachine.setState(id, 'errored', 'verified', `Inject-and-spawn failed: ${injectResult.reason ?? 'unknown'}`);
        return false;
      }
      logMain('launch', `[dll-redirect] account=${id} injected and resumed; pid=${injectResult.pid}`);
      manualAccountPidBindings.set(id, injectResult.pid);
      launchStateMachine.setState(id, 'launcher_started', 'verified', 'DLL-injected direct executable launched');
    } else if (gw2Path && process.platform !== 'linux') {
      console.log('Launching direct executable:', args.join(' '));
      logMain('launch', `Launching account=${id} via direct executable with ${args.length} args`);
      const gw2WorkingDirectory = path.dirname(gw2Path);
      const child = spawn(gw2Path, args, {
        cwd: gw2WorkingDirectory,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.on('error', (spawnError) => {
        console.error(`Spawn error: ${spawnError.message}`);
      });
      child.unref();
      launchStateMachine.setState(id, 'launcher_started', 'inferred', 'Direct executable launch signal sent');
    } else {
      console.log('Launching via Steam:', args.join(' '));
      logMain('launch', `Launching account=${id} via Steam with ${args.length} args`);
      launchViaSteam(args);
      launchStateMachine.setState(id, 'launcher_started', 'inferred', 'Steam launch signal sent');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const launchMode = gw2Path ? 'Direct executable' : 'Steam';
    console.error(`${launchMode} launch failed: ${message}`);
    logMainError('launch', `${launchMode} launch failed for account=${id}: ${message}`);
    launchStateMachine.setState(id, 'errored', 'verified', `${launchMode} launch failed`);
    return false;
  }

  const processWaitTimeoutMs = process.platform === 'win32'
    ? 90000
    : process.platform === 'linux'
      ? LINUX_PROCESS_WAIT_TIMEOUT_MS
      : 25000;
  const launched = await waitForAccountProcess(account.id, processWaitTimeoutMs, preLaunchGw2Pids);
  if (!launched) {
    logMainError(
      'launch',
      `Process not detected for account=${id} (${account.nickname}) within ${processWaitTimeoutMs}ms ` +
      `— GW2 may still be running but the launcher couldn't see it. ` +
      `Check %APPDATA%\\AxiAM\\logs\\main.log for WMI snapshot warnings.`,
    );
    launchStateMachine.setState(id, 'errored', 'inferred', 'Process not detected before timeout');
  } else {
    logMain('launch', `Account=${id} process detected and bound`);
    launchStateMachine.setState(id, 'process_detected', 'verified', 'Account process detected');
    launchStateMachine.setState(id, 'running', 'verified', 'Running with mapped process');
    // Register the binding before the dwell so quitWatcher is watching as
    // early as possible — a fast crash during the dwell still gets noticed
    // when the next poll runs.
    const boundPid = manualAccountPidBindings.get(id)
      ?? getActiveAccountProcesses().find((p) => p.accountId === id)?.pid;
    if (typeof boundPid === 'number') {
      quitWatcher.noteLaunch(id, boundPid);
    }
    if (process.platform === 'win32' && !useJunction && !useDllRedirect) {
      logMain('launch', `[dwell] account=${id} waiting ${LAUNCH_DWELL_AFTER_DETECTED_MS}ms for GW2 to consume Local.dat before releasing launch serializer`);
      await new Promise((resolve) => setTimeout(resolve, LAUNCH_DWELL_AFTER_DETECTED_MS));
    }
  }
  return launched;
}

ipcMain.handle('launch-account', async (_, id) => {
  // Set the requested phase up front so the cancellation check below only
  // catches Stop clicks that happened during the serializer wait. Otherwise a
  // stale 'stopped' from an earlier session would block every future launch.
  launchStateMachine.setState(id, 'launch_requested', 'verified', 'Launch requested (queued)');
  const release = await launchSerializer.acquire();
  try {
    const queuedState = launchStateMachine.getState(id);
    if (queuedState && (queuedState.phase === 'stopping' || queuedState.phase === 'stopped')) {
      logMain('launch', `[serializer] account=${id} skipped: launch was cancelled while queued (phase=${queuedState.phase})`);
      return false;
    }
    return await doLaunch(id);
  } finally {
    release();
  }
});

ipcMain.handle('get-launch-error', async (_, id) => {
  const state = launchStateMachine.getState(id);
  if (!state) return null;
  if (state.phase !== 'errored') return null;
  return state.note || null;
});

ipcMain.handle('save-settings', async (_, settings) => {
  const existingSettings = (store.get('settings') as {
    gw2Path?: string;
    masterPasswordPrompt?: 'every_time' | 'daily' | 'weekly' | 'monthly' | 'never';
    themeId?: string;
  } | undefined) || {};
  const { linuxInputAuthorizationPrewarmAttempted: _drop, ...cleanSettings } = existingSettings as Record<string, unknown>;
  store.set('settings', { ...cleanSettings, ...settings });
  const mergedMode = (settings?.masterPasswordPrompt ?? existingSettings.masterPasswordPrompt ?? 'every_time');
  if (mergedMode !== 'every_time') {
    if (masterKey) {
      store.set('security_v2.cachedMasterKey', encryptForStorage(masterKey));
    }
  } else {
    store.set('security_v2.cachedMasterKey', '');
  }
});

ipcMain.handle('get-settings', async () => {
  if (isDevShowcase) {
    return {
      gw2Path: '/usr/bin/gw2-showcase',
      masterPasswordPrompt: 'never',
      themeId: 'blood_legion',
    };
  }
  return store.get('settings');
});

ipcMain.handle('auto-locate-gw2-path', async () => {
  return autoLocateGw2ExecutablePath();
});

ipcMain.handle('get-runtime-flags', async () => {
  return {
    isDevShowcase,
  };
});

