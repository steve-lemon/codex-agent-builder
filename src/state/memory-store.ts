// Persistence abstraction and in-memory run state store.
import type { RunState } from '../agent/types';
import type { RunStateStore } from './types';

export class InMemoryRunStateStore implements RunStateStore {
  private readonly runs = new Map<string, RunState>();

  async save(run: RunState): Promise<void> {
    this.runs.set(run.runId, { ...run });
  }

  async get(runId: string): Promise<RunState | undefined> {
    const run = this.runs.get(runId);
    return run ? { ...run, stepResults: [...run.stepResults] } : undefined;
  }

  async update(runId: string, updater: (current: RunState) => RunState): Promise<RunState> {
    const current = this.runs.get(runId);
    if (!current) {
      throw new Error(`Run not found: ${runId}`);
    }
    const updated = updater({ ...current, stepResults: [...current.stepResults] });
    this.runs.set(runId, updated);
    return { ...updated, stepResults: [...updated.stepResults] };
  }
}
