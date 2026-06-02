import { describe, it, expect } from 'vitest';
import { gw2DatPath, gw2ExePath, isPatchNeeded } from './patchDetector.js';

describe('patchDetector paths', () => {
  it('derives Gw2.dat and Gw2-64.exe paths from an install dir', () => {
    const dir = '/games/Guild Wars 2';
    expect(gw2DatPath(dir)).toBe('/games/Guild Wars 2/Gw2.dat');
    expect(gw2ExePath(dir)).toBe('/games/Guild Wars 2/Gw2-64.exe');
  });
});

describe('isPatchNeeded', () => {
  it('is true when the exe is newer than the dat', () => {
    expect(isPatchNeeded(2000, 1000)).toBe(true);
  });

  it('is false when the dat is newer than or equal to the exe', () => {
    expect(isPatchNeeded(1000, 2000)).toBe(false);
    expect(isPatchNeeded(1000, 1000)).toBe(false);
  });

  it('is false (fail-safe) when either mtime is null', () => {
    expect(isPatchNeeded(null, 1000)).toBe(false);
    expect(isPatchNeeded(2000, null)).toBe(false);
    expect(isPatchNeeded(null, null)).toBe(false);
  });
});
