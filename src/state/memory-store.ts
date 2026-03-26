// Persistence abstraction and in-memory run state store.
import type { RunState } from '../agent/types';
import type { RunStatePatch, RunStateStore } from './types';
import { AgentError } from '../errors/agent-error';

/** In-memory implementation of the run store for local execution and tests. */
export class InMemoryRunStateStore implements RunStateStore {
  private readonly runs = new Map<string, RunState>();

  async save(run: RunState): Promise<void> {
    this.runs.set(run.runId, { ...run });
  }

  async get(runId: string): Promise<RunState | undefined> {
    const run = this.runs.get(runId);
    return run ? { ...run, stepResults: [...run.stepResults] } : undefined;
  }

  async update(runId: string, updater: (current: RunState) => RunStatePatch): Promise<RunState> {
    const current = this.runs.get(runId);
    if (!current) {
      throw new AgentError(`Run not found: ${runId}`);
    }

    const currentCopy = { ...current, stepResults: [...current.stepResults] };
    const patch = updater(currentCopy);
    const updated: RunState = {
      ...currentCopy,
      ...patch,
      stepResults: patch.stepResults ? [...patch.stepResults] : currentCopy.stepResults
    };

    this.runs.set(runId, updated);
    return { ...updated, stepResults: [...updated.stepResults] };
  }
}
