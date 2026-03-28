import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const STEAM_APP_ID = '1284210';

/**
 * Returns the directory where GW2 stores Local.dat.
 * - Linux: Wine prefix inside Steam compatdata
 * - Windows: %AppData%\Guild Wars 2
 */
export function getGw2DataDirectory(): string | null {
  if (process.platform === 'linux') {
    const home = app.getPath('home');
    const candidate = path.join(
      home, '.local', 'share', 'Steam', 'steamapps', 'compatdata',
      STEAM_APP_ID, 'pfx', 'drive_c', 'users', 'steamuser',
      'AppData', 'Roaming', 'Guild Wars 2',
    );
    return fs.existsSync(candidate) ? candidate : null;
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) return null;
    const candidate = path.join(appData, 'Guild Wars 2');
    return fs.existsSync(candidate) ? candidate : null;
  }

  return null;
}

/** Returns the path to the live Local.dat, or null if it doesn't exist. */
export function getLocalDatPath(): string | null {
  const dir = getGw2DataDirectory();
  if (!dir) return null;
  const filePath = path.join(dir, 'Local.dat');
  return fs.existsSync(filePath) ? filePath : null;
}

/** Directory where per-account Local.dat copies are stored. */
function getStorageDir(): string {
  return path.join(app.getPath('userData'), 'local-dat');
}

/** Returns the storage path for a given account's Local.dat copy. */
function getAccountLocalDatPath(accountId: string): string {
  return path.join(getStorageDir(), `${accountId}.dat`);
}

/** Check if a saved Local.dat exists for an account. */
export function hasLocalDat(accountId: string): boolean {
  return fs.existsSync(getAccountLocalDatPath(accountId));
}

/**
 * Save the current GW2 Local.dat as this account's copy.
 * Returns { success, message }.
 */
export function saveLocalDat(accountId: string): { success: boolean; message: string } {
  const sourcePath = getLocalDatPath();
  if (!sourcePath) {
    return { success: false, message: 'Local.dat not found. Log into GW2 first, then try again.' };
  }

  const storageDir = getStorageDir();
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  const destPath = getAccountLocalDatPath(accountId);
  fs.copyFileSync(sourcePath, destPath);
  return { success: true, message: 'Login saved successfully.' };
}

/**
 * Restore an account's Local.dat into the GW2 data directory.
 * Returns true if the file was placed, false if no saved copy or no target dir.
 */
export function restoreLocalDat(accountId: string): boolean {
  const destDir = getGw2DataDirectory();
  if (!destDir) return false;

  const sourcePath = getAccountLocalDatPath(accountId);
  if (!fs.existsSync(sourcePath)) return false;

  const destPath = path.join(destDir, 'Local.dat');
  fs.copyFileSync(sourcePath, destPath);
  return true;
}

/**
 * Delete a saved Local.dat for an account.
 */
export function deleteLocalDat(accountId: string): void {
  const filePath = getAccountLocalDatPath(accountId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
