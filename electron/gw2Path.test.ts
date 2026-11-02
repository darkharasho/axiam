import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveGw2ExecutablePath } from './gw2Path.js';

describe('resolveGw2ExecutablePath', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2path-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns a configured executable path as-is', () => {
    const exe = path.join(dir, 'Gw2-64.exe');
    fs.writeFileSync(exe, '');
    expect(resolveGw2ExecutablePath(exe)).toBe(exe);
  });

  it('resolves an install directory to the executable inside it', () => {
    // The original bug: "C:\Games\Guild Wars 2" configured as the path.
    const exe = path.join(dir, 'Gw2-64.exe');
    fs.writeFileSync(exe, '');
    expect(resolveGw2ExecutablePath(dir)).toBe(exe);
  });

  it('prefers Gw2-64.exe over Gw2.exe in the same directory', () => {
    const exe64 = path.join(dir, 'Gw2-64.exe');
    fs.writeFileSync(exe64, '');
    fs.writeFileSync(path.join(dir, 'Gw2.exe'), '');
    expect(resolveGw2ExecutablePath(dir)).toBe(exe64);
  });

  it('returns null for a directory with no GW2 executable', () => {
    fs.writeFileSync(path.join(dir, 'readme.txt'), '');
    expect(resolveGw2ExecutablePath(dir)).toBeNull();
  });

  it('returns null for a missing path', () => {
    expect(resolveGw2ExecutablePath(path.join(dir, 'nope'))).toBeNull();
  });

  it('returns null for empty or whitespace input', () => {
    expect(resolveGw2ExecutablePath(undefined)).toBeNull();
    expect(resolveGw2ExecutablePath('')).toBeNull();
    expect(resolveGw2ExecutablePath('   ')).toBeNull();
  });

  it('trims surrounding whitespace from a pasted path', () => {
    const exe = path.join(dir, 'Gw2-64.exe');
    fs.writeFileSync(exe, '');
    expect(resolveGw2ExecutablePath(`  ${exe}  `)).toBe(exe);
  });
});
