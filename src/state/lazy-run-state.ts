// Persistence abstraction and in-memory run state store.
import { AgentError } from '../errors/agent-error';
import type { RunStateStore, RunStateContext } from './types';

/** Creates a cached lazy accessor for run state scoped to a single execution context. */
export function createLazyRunStateContext(store: RunStateStore, runId: string): RunStateContext {
    let cached: Promise<import('../agent/types').RunState> | undefined;

    return {
        async get() {
            if (!cached) {
                cached = store.get(runId).then(run => {
                    if (!run) {
                        throw new AgentError(`Run not found: ${runId}`);
                    }
                    return run;
                });
            }

            return cached;
        },
    };
}
