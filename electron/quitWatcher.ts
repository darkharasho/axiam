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
 *     consecutive polls during the first LAUNCH_GRACE_MS after launch
 *     (absorbing the one-time startup re-exec gap), and on the first absent
 *     poll after that, so a normal quit is noticed within one poll.
 *
 * Polling uses injected pollers so tests can drive the watcher
 * deterministically without spawning real processes.
 */

export type PidPoller = () => number[];
export type AccountLivenessPoller = () => Set<string>;

// One re-exec gap is a single absent poll; 3 gives 2 polls of buffer beyond it.
const QUIT_GRACE_POLLS = 3;
// GW2's launcher re-execs into the game ~14s after launch. Past this window
// there is no expected gap, so one absent poll means the session ended.
export const LAUNCH_GRACE_MS = 90_000;

class QuitWatcher extends EventEmitter {
  private bindings = new Map<string, number>();
  private launchedAt = new Map<string, number>();
  private now: () => number = Date.now;
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
    this.absentPolls.clear();
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
    this.launchedAt.set(accountId, this.now());
    this.absentPolls.delete(accountId);
  }

  noteStop(accountId: string): void {
    this.bindings.delete(accountId);
    this.launchedAt.delete(accountId);
    this.absentPolls.delete(accountId);
  }

  /**
   * Public for tests. Runs one poll cycle synchronously.
   */
  tick(): void {
    if (this.livenessPoller) {
      this.tickLiveness(this.livenessPoller());
    } else {
      this.tickPid(new Set(this.poller()));
    }
  }

  /** Linux: an account is "alive" while any process still carries its mumble
   *  tag. Near launch, fire quit only after QUIT_GRACE_POLLS consecutive absent
   *  polls so the startup re-exec gap isn't mistaken for a quit; after
   *  LAUNCH_GRACE_MS, the first absent poll fires. */
  private tickLiveness(live: Set<string>): void {
    for (const accountId of Array.from(this.bindings.keys())) {
      if (live.has(accountId)) {
        this.absentPolls.delete(accountId);
        continue;
      }
      const absent = (this.absentPolls.get(accountId) ?? 0) + 1;
      const launchedAt = this.launchedAt.get(accountId) ?? 0;
      const inLaunchGrace = this.now() - launchedAt < LAUNCH_GRACE_MS;
      const requiredPolls = inLaunchGrace ? QUIT_GRACE_POLLS : 1;
      if (absent >= requiredPolls) {
        this.bindings.delete(accountId);
        this.launchedAt.delete(accountId);
        this.absentPolls.delete(accountId);
        this.emit('quit', accountId);
      } else {
        this.absentPolls.set(accountId, absent);
      }
    }
  }

  /** Windows: the bound Gw2-64.exe PID is stable for the whole session, so a
   *  single poll where the PID is gone means the session ended. */
  private tickPid(livePids: Set<number>): void {
    for (const [accountId, pid] of Array.from(this.bindings.entries())) {
      if (!livePids.has(pid)) {
        this.bindings.delete(accountId);
        this.launchedAt.delete(accountId);
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
    this.launchedAt.clear();
    this.now = Date.now;
    this.absentPolls.clear();
    this.livenessPoller = null;
  }

  /** Test helper: replace the clock used for the launch grace window. */
  __setClockForTests(now: () => number): void {
    this.now = now;
  }
}

export const quitWatcher = new QuitWatcher();
