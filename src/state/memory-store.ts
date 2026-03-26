// Persistence abstraction and in-memory run state store.
import type { RunState, RunStateResult, StepResult } from '../agent/types';
import type { RunStatePatch, RunStateStore } from './types';
import { AgentError } from '../errors/agent-error';
import { now } from '../time/now';

/** In-memory implementation of the run store for local execution and tests. */
export class InMemoryRunStateStore implements RunStateStore {
  private readonly runs = new Map<string, Omit<RunState, 'stepResults'>>();
  private readonly results = new Map<string, Map<number, RunStateResult>>();

  async save(run: RunState): Promise<void> {
    this.runs.set(run.runId, this.toStoredRun(run));
  }

  async get(runId: string): Promise<RunState | undefined> {
    const run = this.runs.get(runId);
    return run ? this.hydrateRun(run) : undefined;
  }

  async update(runId: string, updater: (current: RunState) => RunStatePatch): Promise<RunState> {
    const current = this.runs.get(runId);
    if (!current) {
      throw new AgentError(`Run not found: ${runId}`);
    }

    const currentCopy = this.hydrateRun(current);
    const patch = updater(currentCopy);
    const updated: RunState = {
      ...currentCopy,
      ...patch,
      stepResults: patch.stepResults ? [...patch.stepResults] : currentCopy.stepResults
    };

    this.runs.set(runId, this.toStoredRun(updated));
    return this.hydrateRun(this.runs.get(runId)!);
  }

  async appendStepResult(runId: string, stepResult: StepResult): Promise<RunStateResult> {
    const current = this.runs.get(runId);
    if (!current) {
      throw new AgentError(`Run not found: ${runId}`);
    }

    const nextResultNo = current.resultNo + 1;
    const resultRecord: RunStateResult = {
      id: `${runId}:result:${nextResultNo}`,
      runId,
      resultNo: nextResultNo,
      stepResult,
      createdAt: now()
    };

    const runResults = this.results.get(runId) ?? new Map<number, RunStateResult>();
    runResults.set(nextResultNo, resultRecord);
    this.results.set(runId, runResults);
    this.runs.set(runId, {
      ...current,
      resultNo: nextResultNo
    });

    return { ...resultRecord, stepResult: { ...resultRecord.stepResult } };
  }

  private toStoredRun(run: RunState): Omit<RunState, 'stepResults'> {
    return {
      runId: run.runId,
      traceId: run.traceId,
      userInput: run.userInput,
      skillName: run.skillName,
      skillInstructions: run.skillInstructions,
      allowedTools: [...run.allowedTools],
      plan: run.plan,
      currentStepIndex: run.currentStepIndex,
      resultNo: run.resultNo,
      pendingApproval: run.pendingApproval,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt
    };
  }

  private hydrateRun(run: Omit<RunState, 'stepResults'>): RunState {
    const runResults = this.results.get(run.runId) ?? new Map<number, RunStateResult>();
    const stepResults: StepResult[] = [];

    for (let resultNo = 1; resultNo <= run.resultNo; resultNo += 1) {
      const resultRecord = runResults.get(resultNo);
      if (!resultRecord) {
        throw new AgentError(`Run result not found: ${run.runId}:${resultNo}`);
      }
      stepResults.push({ ...resultRecord.stepResult });
    }

    return {
      ...run,
      stepResults
    };
  }
}
