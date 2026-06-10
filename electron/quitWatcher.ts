import { EventEmitter } from 'events';

/**
 * Watches tracked GW2 accounts and emits 'quit' events when a tracked account
 * process ends.
 *
 * Lifecycle:
 *   start() once at app.ready (runs on ALL platforms — main.ts decides which
 *     poller strategy to configure: liveness on Linux, PID-based on Windows).
 *   noteLaunch(accountId, pid) after a successful spawn + detection.
 *   noteStop(accountId) when the user explicitly stops an account (silently
 *     drops the binding — we DON'T snapshot on explicit stop).
 *   stop() once at app.before-quit.
 *
 * Emits: 'quit' with `accountId: string`.
 *
 * Two tick strategies:
 *   - PID-based (Windows): configure(poller, ms) — fires when PID leaves the
 *     system process table.
 *   - Liveness-based (Linux/Proton): configure(poller, ms, livenessPoller) —
 *     fires when an account's mumble tag is absent for QUIT_GRACE_POLLS
 *     consecutive polls, absorbing the one-time re-exec gap after launch.
 *
 * Polling uses injected pollers so tests can drive the watcher
 * deterministically without spawning real processes.
 */

export type PidPoller = () => number[];
export type AccountLivenessPoller = () => Set<string>;

const QUIT_GRACE_POLLS = 3;

class QuitWatcher extends EventEmitter {
  private bindings = new Map<string, number>();
  private absentPolls = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private poller: PidPoller = () => [];
  private livenessPoller: AccountLivenessPoller | null = null;
  private intervalMs = 2000;

  configure(
    poller: PidPoller,
    intervalMs: number,
    livenessPoller?: AccountLivenessPoller,
  ): void {
    this.poller = poller;
    this.intervalMs = intervalMs;
    this.livenessPoller = livenessPoller ?? null;
  }

  start(): void {
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
    this.absentPolls.delete(accountId);
  }

  noteStop(accountId: string): void {
    this.bindings.delete(accountId);
    this.absentPolls.delete(accountId);
  }

  /**
   * Public for tests. Runs one poll cycle synchronously.
   */
  tick(): void {
    if (this.livenessPoller) {
      const live = this.livenessPoller();
      for (const accountId of Array.from(this.bindings.keys())) {
        if (live.has(accountId)) {
          this.absentPolls.delete(accountId);
          continue;
        }
        const absent = (this.absentPolls.get(accountId) ?? 0) + 1;
        if (absent >= QUIT_GRACE_POLLS) {
          this.bindings.delete(accountId);
          this.absentPolls.delete(accountId);
          this.emit('quit', accountId);
        } else {
          this.absentPolls.set(accountId, absent);
        }
      }
      return;
    }

    const livePids = new Set(this.poller());
    for (const [accountId, pid] of Array.from(this.bindings.entries())) {
      if (!livePids.has(pid)) {
        this.bindings.delete(accountId);
        this.emit('quit', accountId);
      }
    }
  }

  /**
   * Test helper: clear all bindings, absent-poll counters, and stop the timer.
   */
  __resetForTests(): void {
    this.stop();
    this.bindings.clear();
    this.absentPolls.clear();
    this.livenessPoller = null;
  }
}

export const quitWatcher = new QuitWatcher();
