import { describe, it, expect } from 'vitest';
import { gw2DatPath, gw2ExePath, isPatchNeeded } from './patchDetector.js';
import { createStabilityState, stepStability } from './patchDetector.js';
import type { StabilityConfig, StabilitySample } from './patchDetector.js';

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

const CONFIG: StabilityConfig = { quietWindowMs: 10_000, graceWindowMs: 20_000, ceilingMs: 300_000 };
const sample = (size: number, mtimeMs: number): StabilitySample => ({ size, mtimeMs });

describe('stepStability', () => {
  it('stays pending while the dat keeps changing', () => {
    let state = createStabilityState(0);
    let r = stepStability(state, sample(100, 100), 2_000, CONFIG);
    expect(r.verdict).toBe('pending');
    r = stepStability(r.state, sample(200, 200), 4_000, CONFIG);
    expect(r.verdict).toBe('pending');
    r = stepStability(r.state, sample(300, 300), 6_000, CONFIG);
    expect(r.verdict).toBe('pending');
  });

  it('resolves done after the quiet window once it changed then held steady', () => {
    let state = createStabilityState(0);
    // Baseline sample at t=2s.
    let r = stepStability(state, sample(100, 100), 2_000, CONFIG);
    expect(r.verdict).toBe('pending');
    // Real change at t=4s (patcher wrote to the dat).
    r = stepStability(r.state, sample(200, 200), 4_000, CONFIG);
    expect(r.verdict).toBe('pending');
    // Steady at t=10s — only 6s since the change, still inside the quiet window.
    r = stepStability(r.state, sample(200, 200), 10_000, CONFIG);
    expect(r.verdict).toBe('pending');
    // Steady at t=14s — 10s since the change → done.
    r = stepStability(r.state, sample(200, 200), 14_000, CONFIG);
    expect(r.verdict).toBe('done');
  });

  it('does not resolve done from the baseline alone when nothing ever changes', () => {
    // Guards the real-world case where the patcher is slow to make its first
    // write: the baseline sample must not start the quiet-window clock.
    let state = createStabilityState(0);
    let r = stepStability(state, sample(100, 100), 2_000, CONFIG);
    expect(r.verdict).toBe('pending');
    // 13s after the baseline (> quietWindow) but before the grace window and
    // with no real change — must stay pending, not falsely report done.
    r = stepStability(r.state, sample(100, 100), 15_000, CONFIG);
    expect(r.verdict).toBe('pending');
  });

  it('resolves proceed after the grace window when nothing ever changes', () => {
    let state = createStabilityState(0);
    let r = stepStability(state, sample(100, 100), 5_000, CONFIG);
    expect(r.verdict).toBe('pending');
    r = stepStability(r.state, sample(100, 100), 20_000, CONFIG);
    expect(r.verdict).toBe('proceed');
  });

  it('stays pending after a real change while inside the quiet window, even past the grace window', () => {
    let state = createStabilityState(0);
    // Baseline at t=2s, real change at t=18s.
    let r = stepStability(state, sample(100, 100), 2_000, CONFIG);
    expect(r.verdict).toBe('pending');
    r = stepStability(r.state, sample(200, 200), 18_000, CONFIG);
    expect(r.verdict).toBe('pending');
    // t=25s: past the grace window (20s from start) but only 7s since the change
    // (< 10s quiet window). changedOnce is true so proceed must NOT fire, and the
    // quiet window has not elapsed so done must NOT fire → still pending.
    r = stepStability(r.state, sample(200, 200), 25_000, CONFIG);
    expect(r.verdict).toBe('pending');
  });

  it('resolves timeout at the ceiling even if still changing', () => {
    let state = createStabilityState(0);
    let r = stepStability(state, sample(100, 100), 2_000, CONFIG);
    expect(r.verdict).toBe('pending');
    r = stepStability(r.state, sample(999, 999), 300_000, CONFIG);
    expect(r.verdict).toBe('timeout');
  });
});
