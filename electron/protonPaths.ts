import * as path from 'path';
import * as fs from 'fs';

export const STEAM_GW2_APP_ID = '1284210';

export interface ProtonPathsFs {
  existsSync: (path: string) => boolean;
}

/**
 * Given a list of Steam library paths, return the first one that contains
 * `steamapps/compatdata/<GW2 app id>`, or null if none do.
 *
 * Used by both `localDat.ts` (to find the host Local.dat) and `mutexCloser.ts`
 * (to find the Proton prefix). Pure function — no I/O outside the injected fs.
 */
export function resolveGw2CompatDataDir(
  steamLibraryPaths: string[],
  filesystem: ProtonPathsFs = fs,
): string | null {
  for (const lib of steamLibraryPaths) {
    const compat = path.join(lib, 'steamapps', 'compatdata', STEAM_GW2_APP_ID);
    if (filesystem.existsSync(compat)) return compat;
  }
  return null;
}
