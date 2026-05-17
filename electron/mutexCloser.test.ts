import { describe, it, expect } from 'vitest';
import { interpretHelperResult, type SpawnResult } from './mutexCloser.js';

function result(status: number | null, stdout = '', stderr = ''): SpawnResult {
  return { status, stdout, stderr, error: null };
}

describe('interpretHelperResult', () => {
  it('returns ok=true with closedCount on exit 0', () => {
    const r = interpretHelperResult(result(0, '{"closed":2,"targets":2}'));
    expect(r).toEqual({ ok: true, closedCount: 2 });
  });

  it('returns ok=true closedCount=0 on exit 2 (no matching mutex)', () => {
    const r = interpretHelperResult(result(2, ''));
    expect(r.ok).toBe(true);
    expect(r.closedCount).toBe(0);
  });

  it('returns ok=true closedCount=0 on exit 3 (no target processes)', () => {
    const r = interpretHelperResult(result(3, ''));
    expect(r.ok).toBe(true);
    expect(r.closedCount).toBe(0);
  });

  it('returns ok=false with stderr on exit 4', () => {
    const r = interpretHelperResult(result(4, '', 'OpenProcess failed'));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('OpenProcess');
  });

  it('returns ok=false on unknown exit code', () => {
    const r = interpretHelperResult(result(99));
    expect(r.ok).toBe(false);
  });

  it('returns ok=false when spawn errored (e.g. binary missing)', () => {
    const r = interpretHelperResult({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('ENOENT: no such file or directory'),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('ENOENT');
  });

  it('parses closed count from stdout when JSON is well-formed', () => {
    const r = interpretHelperResult(result(0, '{"closed":5,"targets":7}'));
    expect(r.closedCount).toBe(5);
  });

  it('defaults closedCount to 1 on exit 0 when JSON is missing or malformed', () => {
    const r = interpretHelperResult(result(0, 'not-json'));
    expect(r).toEqual({ ok: true, closedCount: 1 });
  });
});
