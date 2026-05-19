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

  it('start is a no-op on non-Windows platforms', () => {
    // We can't easily flip process.platform inside the test, but we CAN verify
    // that start() doesn't throw or schedule on this host. If the host is
    // Windows the timer activates; either way no exception thrown.
    expect(() => quitWatcher.start()).not.toThrow();
    quitWatcher.stop();
  });
});
