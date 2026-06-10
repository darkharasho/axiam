import { describe, it, expect, beforeEach } from 'vitest';
import { quitWatcher } from './quitWatcher.js';

describe('quitWatcher', () => {
  beforeEach(() => {
    quitWatcher.__resetForTests();
    quitWatcher.removeAllListeners('quit');
  });

  it('fires quit event when a tracked PID disappears from the poll', () => {
    const events: string[] = [];
    quitWatcher.on('quit', (accountId: string) => events.push(accountId));
    let livePids = [1000];
    quitWatcher.configure(() => livePids, 100);
    quitWatcher.noteLaunch('acc-a', 1000);

    quitWatcher.tick(); // PID 1000 still alive
    expect(events).toEqual([]);

    livePids = []; // PID 1000 disappeared
    quitWatcher.tick();
    expect(events).toEqual(['acc-a']);
  });

  it('only emits once per tracked PID even if it stays gone across ticks', () => {
    const events: string[] = [];
    quitWatcher.on('quit', (accountId: string) => events.push(accountId));
    quitWatcher.configure(() => [], 100);
    quitWatcher.noteLaunch('acc-a', 1000);

    quitWatcher.tick(); // pid gone -> event fires
    quitWatcher.tick(); // already cleared from bindings -> no event
    quitWatcher.tick();
    expect(events).toEqual(['acc-a']);
  });

  it('noteStop drops the binding silently without firing quit', () => {
    const events: string[] = [];
    quitWatcher.on('quit', (accountId: string) => events.push(accountId));
    quitWatcher.configure(() => [], 100);
    quitWatcher.noteLaunch('acc-a', 1000);

    quitWatcher.noteStop('acc-a'); // user explicitly stopped
    quitWatcher.tick(); // pid is gone but we already dropped the binding

    expect(events).toEqual([]);
  });

  it('tracks multiple accounts and only fires for the gone one', () => {
    const events: string[] = [];
    quitWatcher.on('quit', (accountId: string) => events.push(accountId));
    let livePids = [1000, 2000];
    quitWatcher.configure(() => livePids, 100);
    quitWatcher.noteLaunch('acc-a', 1000);
    quitWatcher.noteLaunch('acc-b', 2000);

    livePids = [2000]; // only acc-a's PID disappears
    quitWatcher.tick();
    expect(events).toEqual(['acc-a']);
  });

  it('start() does not throw and activates the polling timer', () => {
    // start() now runs on all platforms — the platform-specific branching is
    // in how main.ts configures the watcher (liveness poller on Linux, PID
    // poller on Windows). Either way start() must not throw.
    expect(() => quitWatcher.start()).not.toThrow();
    quitWatcher.stop();
  });

  it('linux: fires quit after the grace window of absent liveness polls', () => {
    const events: string[] = [];
    quitWatcher.on('quit', (id: string) => events.push(id));
    let live = new Set(['acc-a']);
    quitWatcher.configure(() => [], 100, () => live);
    quitWatcher.noteLaunch('acc-a', 1000);

    quitWatcher.tick();                 // present
    expect(events).toEqual([]);
    live = new Set<string>();           // account tag gone
    quitWatcher.tick();                 // absent 1 (< grace)
    quitWatcher.tick();                 // absent 2 (< grace)
    expect(events).toEqual([]);
    quitWatcher.tick();                 // absent 3 (== grace) -> fire
    expect(events).toEqual(['acc-a']);
  });

  it('linux: counter resets when the account reappears mid-grace window', () => {
    const events: string[] = [];
    quitWatcher.on('quit', (id: string) => events.push(id));
    let live = new Set(['acc-a']);
    quitWatcher.configure(() => [], 100, () => live);
    quitWatcher.noteLaunch('acc-a', 1000);

    quitWatcher.tick();                 // present
    live = new Set<string>();
    quitWatcher.tick();                 // absent 1 (re-exec gap)
    live = new Set(['acc-a']);          // game back under new pid
    quitWatcher.tick();                 // present -> counter resets
    live = new Set<string>();
    quitWatcher.tick();                 // absent 1 again
    quitWatcher.tick();                 // absent 2
    expect(events).toEqual([]);         // never reached grace
  });

  it('linux: liveness mode fires quit only once after the account stays gone', () => {
    const events: string[] = [];
    quitWatcher.on('quit', (id: string) => events.push(id));
    const live = new Set<string>(['acc-a']);
    quitWatcher.configure(() => [], 100, () => live);
    quitWatcher.noteLaunch('acc-a', 1000);

    quitWatcher.tick();          // present
    live.delete('acc-a');
    quitWatcher.tick();          // absent 1
    quitWatcher.tick();          // absent 2
    quitWatcher.tick();          // absent 3 -> fire (binding deleted)
    quitWatcher.tick();          // still gone, but no binding -> no re-fire
    quitWatcher.tick();
    expect(events).toEqual(['acc-a']);
  });

  it('linux: noteStop drops the binding without waiting out the grace window', () => {
    const events: string[] = [];
    quitWatcher.on('quit', (id: string) => events.push(id));
    const live = new Set(['acc-a']);
    quitWatcher.configure(() => [], 100, () => live);
    quitWatcher.noteLaunch('acc-a', 1000);
    quitWatcher.tick();
    quitWatcher.noteStop('acc-a');
    live.delete('acc-a');
    quitWatcher.tick();
    quitWatcher.tick();
    quitWatcher.tick();
    expect(events).toEqual([]);
  });
});
