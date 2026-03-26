// Vitest specs for core runtime behaviors.
import { describe, expect, it } from 'vitest';
import { InMemoryRunStateStore } from './memory-store';
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

describe('InMemoryRunStateStore.update', () => {
    it('applies only the returned patch and preserves untouched fields', async () => {
        const store = new InMemoryRunStateStore();
        const original = makeRunState('run-1');
        await store.save(original);

        const updated = await store.update('run-1', () => ({
            status: 'completed',
            updatedAt: 2,
        }));

        expect(updated).toEqual({
            ...original,
            status: 'completed',
            updatedAt: 2,
        });
    });

    it('can derive a partial patch from the current state', async () => {
        const store = new InMemoryRunStateStore();
        const original = makeRunState('run-2');
        await store.save(original);

        await store.appendStepResult('run-2', {
            stepId: 's1',
            mode: 'reasoning',
            output: { ok: true },
        });

        const updated = await store.update('run-2', current => ({
            currentStepIndex: current.currentStepIndex + 1,
            updatedAt: 3,
        }));

        expect(updated.currentStepIndex).toBe(1);
        expect(updated.resultNo).toBe(1);
        expect(updated.stepResults).toEqual([
            {
                stepId: 's1',
                mode: 'reasoning',
                output: { ok: true },
            },
        ]);
        expect(updated.status).toBe('running');
        expect(updated.createdAt).toBe(1);
    });

    it('stores step results as child records and hydrates them through get', async () => {
        const store = new InMemoryRunStateStore();
        await store.save(makeRunState('run-3'));

        const resultRecord = await store.appendStepResult('run-3', {
            stepId: 's1',
            mode: 'reasoning',
            output: { size: 'large-payload-placeholder' },
        });

        const hydrated = await store.get('run-3');

        expect(resultRecord.id).toBe('run-3:result:1');
        expect(resultRecord.resultNo).toBe(1);
        expect(hydrated?.resultNo).toBe(1);
        expect(hydrated?.stepResults).toEqual([
            {
                stepId: 's1',
                mode: 'reasoning',
                output: { size: 'large-payload-placeholder' },
            },
        ]);
    });
});
