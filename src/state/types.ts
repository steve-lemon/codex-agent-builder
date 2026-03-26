// Persistence abstraction and in-memory run state store.
import type { RunState } from '../agent/types';

export interface RunStateStore {
  save(run: RunState): Promise<void>;
  get(runId: string): Promise<RunState | undefined>;
  update(runId: string, updater: (current: RunState) => RunState): Promise<RunState>;
}
