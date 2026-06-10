/**
 * Build the managed command-line arguments AxiAM passes to GW2.
 *
 * The subtle one is `-shareArchive`. It opens Gw2.dat in shared/read-only mode
 * so multiple concurrent clients can share a single archive — but a read-only
 * archive ALSO blocks ArenaNet's patcher from writing a pending update. When an
 * update is pending and we pass `-shareArchive`, the launcher fails its update
 * check with "Download failed! Please check your internet connection and try
 * again. (5)".
 *
 * The fix: only add `-shareArchive` for the SECOND-or-later concurrent instance
 * (`isMultiInstance` — another GW2 is already running, so the archive is already
 * patched and open). A solo launch must be able to patch, so it omits the flag.
 * A user who explicitly puts `-shareArchive` in their per-account launch
 * arguments still gets it (we never duplicate it).
 */
export interface ManagedLaunchArgsOptions {
  /** MumbleLink object name for this account. */
  mumbleName: string;
  /** Whether to pass -autologin (a saved login is present and installed). */
  useAutologin: boolean;
  /** True when another GW2 instance is already running (true multibox launch). */
  isMultiInstance: boolean;
  /** User-supplied per-account launch arguments, already sanitized. */
  userExtras: string[];
}

export function buildManagedLaunchArgs(options: ManagedLaunchArgsOptions): string[] {
  const { mumbleName, useAutologin, isMultiInstance, userExtras } = options;
  const userHasShareArchive = userExtras.some((a) => a.toLowerCase() === '-sharearchive');
  const addShareArchive = isMultiInstance && !userHasShareArchive;

  return [
    '-mumble', mumbleName,
    ...(useAutologin ? ['-autologin'] : []),
    ...(addShareArchive ? ['-shareArchive'] : []),
    ...userExtras,
  ];
}
