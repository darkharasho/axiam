export type LaunchPhase =
  | 'idle'
  | 'launch_requested'
  | 'patching'
  | 'launcher_started'
  | 'credentials_waiting'
  | 'credentials_submitted'
  | 'process_detected'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'errored';

export type StateCertainty = 'verified' | 'inferred';

export interface LaunchState {
  accountId: string;
  phase: LaunchPhase;
  certainty: StateCertainty;
  updatedAt: number;
  note?: string;
}

export class LaunchStateMachine {
  private readonly states = new Map<string, LaunchState>();

  setState(accountId: string, phase: LaunchPhase, certainty: StateCertainty, note?: string): void {
    this.states.set(accountId, {
      accountId,
      phase,
      certainty,
      updatedAt: Date.now(),
      note: note?.trim() || undefined,
    });
  }

  getState(accountId: string): LaunchState | undefined {
    return this.states.get(accountId);
  }

  getAllStates(): LaunchState[] {
    return Array.from(this.states.values());
  }

  clearState(accountId: string): void {
    this.states.delete(accountId);
  }

  clearAll(): void {
    this.states.clear();
  }

  prune(accountIds: string[]): void {
    const allowed = new Set(accountIds);
    Array.from(this.states.keys()).forEach((id) => {
      if (!allowed.has(id)) {
        this.states.delete(id);
      }
    });
  }
}
