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
import { saveLocalDat, hasLocalDat, deleteLocalDat, restoreLocalDat, getSteamLibraryPaths } from './localDat.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const { autoUpdater } = electronUpdaterPkg;

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
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
let windowsProcessSnapshotCache: { timestamp: number; processes: any[] } = { timestamp: 0, processes: [] };
let resolvedWindowsPowerShellPath: string | null = null;

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
const showcaseActiveAccounts = new Set<string>(['showcase-a']);
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

async function waitForAccountProcess(accountId: string, timeoutMs = 25000): Promise<boolean> {
  const startedAt = Date.now();
  const pollIntervalMs = process.platform === 'win32' ? 1200 : 500;
  while (Date.now() - startedAt < timeoutMs) {
    const active = getActiveAccountProcesses();
    if (active.some((processInfo) => processInfo.accountId === accountId)) {
      return true;
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
    ? new RegExp(`(?:^|[\\/\\s])(?:gw2-64(?:\\.exe)?|gw2(?:\\.exe)?|${escapedConfiguredName})(?:\\s|$)`, 'i')
    : /(?:^|[\/\s])(?:gw2-64(?:\.exe)?|gw2(?:\.exe)?)(?:\s|$)/i;
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

    for (const processInfo of processes) {
      const imageName = String(processInfo?.Name || '').toLowerCase();
      if (!imageName || !names.includes(imageName)) continue;
      const pid = Number(processInfo?.ProcessId);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      const commandLine = String(processInfo?.CommandLine || '');
      const mumbleName = extractMumbleNameFromCommandLine(commandLine);
      if (!mumbleName) continue;
      const accountId = mumbleToAccountId.get(mumbleName);
      if (!accountId) continue;
      if (!foundByAccount.has(accountId)) {
        foundByAccount.set(accountId, { accountId, pid, mumbleName });
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
    icon: appIconPath,
    // titleBarStyle: 'hidden', 
    resizable: true, // Allow resize but keep default small
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
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
  console.log("User Data Path:", app.getPath('userData'));
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
      releaseNotes: `# Release Notes\n\nVersion v${version}\n\n## ðŸŒŸ Highlights\n- Fake update mode is active for local UI testing.\n\n## ðŸ› ï¸ Improvements\n- Added a simulated updater flow (checking, downloading, restart).\n\n## ðŸ§¯ Fixes\n- What\\'s New can now be previewed without publishing a GitHub release.\n\n## âš ï¸ Breaking Changes\n- None.`,
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

ipcMain.handle('save-local-dat', async (_, accountId: string) => {
  return saveLocalDat(accountId);
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
  return true;
});

ipcMain.handle('launch-account', async (_, id) => {
  if (isDevShowcase) {
    showcaseActiveAccounts.clear();
    showcaseActiveAccounts.add(String(id));
    return true;
  }
  if (!masterKey) throw new Error('Master key not set');

  // Linux: prevent multiple instances
  if (process.platform === 'linux') {
    const runningPids = getAllRunningGw2Pids();
    if (runningPids.length > 0) {
      logMainWarn('launch', `Aborting launch for account=${id}: Linux instance already running (pids=${runningPids.join(',')})`);
      launchStateMachine.setState(id, 'errored', 'verified', 'Another GW2 instance is already running');
      return false;
    }
  }

  launchStateMachine.setState(id, 'launch_requested', 'verified', 'Launch requested');

  // @ts-ignore
  const accounts = (store.get('accounts') as any[]) || [];
  const account = accounts.find((a: any) => a.id === id);
  if (!account) {
    logMainError('launch', `Account not found for id=${id}`);
    return false;
  }

  const launchSettings = (store.get('settings') as { gw2Path?: string } | undefined) || {};
  const gw2Path = launchSettings?.gw2Path?.trim();

  if (gw2Path && !fs.existsSync(gw2Path)) {
    console.error(`GW2 path does not exist: ${gw2Path}`);
    logMainError('launch', `GW2 path does not exist for account=${id}: ${gw2Path}`);
    launchStateMachine.setState(id, 'errored', 'verified', 'GW2 path missing');
    return false;
  }

  const extraArgs = splitLaunchArguments(account.launchArguments);
  const sanitizedExtraArgs = stripManagedLaunchArguments(extraArgs);
  const mumbleName = getAccountMumbleName(account.id);

  // Swap Local.dat if available — enables -autologin (no UI automation needed)
  const hasAuth = restoreLocalDat(account.id);
  if (hasAuth) {
    logMain('launch', `[local-dat] Restored Local.dat for account=${id}, using -autologin`);
  } else {
    logMain('launch', `[local-dat] No saved Local.dat for account=${id}, launching without -autologin`);
  }

  const args = [
    '--mumble', mumbleName,
    ...(hasAuth ? ['-autologin'] : []),
    ...sanitizedExtraArgs,
  ];
  try {
    if (gw2Path) {
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
  const launched = await waitForAccountProcess(account.id, processWaitTimeoutMs);
  if (!launched) {
    console.error(`GW2 did not appear as running for account ${account.nickname} within timeout.`);
    launchStateMachine.setState(id, 'errored', 'inferred', 'Process not detected before timeout');
  } else {
    launchStateMachine.setState(id, 'process_detected', 'verified', 'Account process detected');
    launchStateMachine.setState(id, 'running', 'verified', 'Running with mapped process');
  }
  return launched;
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

