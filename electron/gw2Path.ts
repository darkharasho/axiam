import fs from 'fs';
import path from 'path';

/* Users (and Windows folder pickers) hand us the install DIRECTORY —
   "C:\Games\Guild Wars 2" — at least as often as the executable itself.
   Spawning a directory fails only asynchronously on Windows, so the launch
   sits in "launcher started" until the process-wait times out and the card
   flips to ERRORED with no useful message. Every consumer of the configured
   path goes through this resolver so a directory is as good as the exe. */

/** Executable names to look for inside an install directory, in order. */
const GW2_EXECUTABLE_NAMES = ['Gw2-64.exe', 'Gw2.exe', 'gw2-64', 'gw2'];

/**
 * Resolve a user-supplied GW2 path — the executable itself or its install
 * directory — to the executable. Returns null when nothing launchable is
 * there (missing path, or a directory with no GW2 executable in it).
 */
export function resolveGw2ExecutablePath(configured?: string): string | null {
  const trimmed = configured?.trim();
  if (!trimmed) return null;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(trimmed);
  } catch {
    return null;
  }

  if (stat.isFile()) return trimmed;

  if (stat.isDirectory()) {
    for (const name of GW2_EXECUTABLE_NAMES) {
      const candidate = path.join(trimmed, name);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* not there; try the next name */
      }
    }
  }

  return null;
}
