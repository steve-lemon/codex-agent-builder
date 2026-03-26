// Vitest specs for core runtime behaviors.
import { describe, expect, it } from 'vitest';
import { createLazyRunStateContext } from './lazy-run-state';
import type { RunStateStore } from './types';
import type { RunState } from '../agent/types';

function makeRunState(runId: string): RunState {
    return {
        runId,
        traceId: runId,
        userInput: 'hello',
        skillName: 'customer-support-reviewer',
        skillInstructions: 'instructions',
        allowedTools: ['getCustomerById'],
        plan: {
            steps: [{ id: 's1', mode: 'reasoning', description: 'reasoning' }],
        },
        currentStepIndex: 0,
        resultNo: 0,
        stepResults: [],
        status: 'running',
        createdAt: 1,
        updatedAt: 1,
    };
}

describe('createLazyRunStateContext', () => {
    it('does not read from the store until get is called', () => {
        let reads = 0;
        const store: RunStateStore = {
            async save() {},
            async get() {
                reads += 1;
                return makeRunState('run-1');
            },
            async update() {
                throw new Error('not used');
            },
            async appendStepResult() {
                throw new Error('not used');
            },
        };

        createLazyRunStateContext(store, 'run-1');

        expect(reads).toBe(0);
    });

    it('loads the run state lazily and caches the first read for the same context', async () => {
        let reads = 0;
        const store: RunStateStore = {
            async save() {},
            async get() {
                reads += 1;
                return makeRunState('run-1');
            },
            async update() {
                throw new Error('not used');
            },
            async appendStepResult() {
                throw new Error('not used');
            },
        };

        const context = createLazyRunStateContext(store, 'run-1');
        const first = await context.get();
        const second = await context.get();

        expect(first.runId).toBe('run-1');
        expect(second).toBe(first);
        expect(reads).toBe(1);
    });

    it('throws when the run state cannot be found', async () => {
        const store: RunStateStore = {
            async save() {},
            async get() {
                return undefined;
            },
            async update() {
                throw new Error('not used');
            },
            async appendStepResult() {
                throw new Error('not used');
            },
        };

        const context = createLazyRunStateContext(store, 'missing-run');

        await expect(context.get()).rejects.toThrow(/Run not found: missing-run/);
    });
});
