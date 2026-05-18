import { EventEmitter } from 'events';

/**
 * Watches a set of tracked `Gw2-64.exe` PIDs and emits 'quit' events when a
 * tracked PID disappears from the system process table.
 *
 * Lifecycle:
 *   start() once at app.ready (Windows only — Linux is a no-op).
 *   noteLaunch(accountId, pid) after a successful spawn + detection.
 *   noteStop(accountId) when the user explicitly stops an account (silently
 *     drops the binding — we DON'T snapshot on explicit stop).
 *   stop() once at app.before-quit.
 *
 * Emits: 'quit' with `accountId: string`.
 *
 * Polling uses an injected `getRunningPids` so tests can drive the watcher
 * deterministically without spawning real processes.
 */

export type PidPoller = () => number[];

class QuitWatcher extends EventEmitter {
  private bindings = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private poller: PidPoller = () => [];
  private intervalMs = 2000;

  configure(poller: PidPoller, intervalMs: number): void {
    this.poller = poller;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (process.platform !== 'win32') return;
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  noteLaunch(accountId: string, pid: number): void {
    this.bindings.set(accountId, pid);
  }

  noteStop(accountId: string): void {
    this.bindings.delete(accountId);
  }

  /**
   * Public for tests. Runs one poll cycle synchronously.
   */
  tick(): void {
    const livePids = new Set(this.poller());
    for (const [accountId, pid] of Array.from(this.bindings.entries())) {
      if (!livePids.has(pid)) {
        this.bindings.delete(accountId);
        this.emit('quit', accountId);
      }
    }
  }

  /**
   * Test helper: clear all bindings + stop the timer.
   */
  __resetForTests(): void {
    this.stop();
    this.bindings.clear();
  }
}

export const quitWatcher = new QuitWatcher();
