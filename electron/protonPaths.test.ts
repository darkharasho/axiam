import { describe, it, expect } from 'vitest';
import { resolveGw2CompatDataDir, STEAM_GW2_APP_ID } from './protonPaths.js';

const fsWith = (existing: string[]) => ({
  existsSync: (p: string) => existing.includes(p),
});

describe('resolveGw2CompatDataDir', () => {
  it('returns null when no libraries have compatdata', () => {
    expect(resolveGw2CompatDataDir(['/lib/a', '/lib/b'], fsWith([]))).toBeNull();
  });

  it('returns the compatdata dir of the first matching library', () => {
    const match = `/lib/b/steamapps/compatdata/${STEAM_GW2_APP_ID}`;
    expect(resolveGw2CompatDataDir(['/lib/a', '/lib/b'], fsWith([match]))).toBe(match);
  });

  it('first-match wins when multiple libraries have compatdata', () => {
    const a = `/lib/a/steamapps/compatdata/${STEAM_GW2_APP_ID}`;
    const b = `/lib/b/steamapps/compatdata/${STEAM_GW2_APP_ID}`;
    expect(resolveGw2CompatDataDir(['/lib/a', '/lib/b'], fsWith([a, b]))).toBe(a);
  });
});
