// Persistence abstraction and in-memory run state store.
import type { RunState, RunStateResult, StepResult } from '../agent/types';

/** Partial mutation payload returned by a state update operation. */
export type RunStatePatch = Partial<RunState>;

/** Persistence contract for saving, loading, and mutating run state. */
export interface RunStateStore {
  save(run: RunState): Promise<void>;
  get(runId: string): Promise<RunState | undefined>;
  update(runId: string, updater: (current: RunState) => RunStatePatch): Promise<RunState>;
  appendStepResult(runId: string, stepResult: StepResult): Promise<RunStateResult>;
}

/** Lazy accessor that loads run state from persistence only when requested. */
export interface RunStateContext {
  get(): Promise<RunState>;
}
