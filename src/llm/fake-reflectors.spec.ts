// Vitest specs for deterministic fake reflector helpers.
import { describe, expect, it } from 'vitest';
import { buildDeterministicReflectorOutput } from './fake-reflectors';

describe('fake reflectors', () => {
    it('marks successful runs as complete without missing items', () => {
        const output = buildDeterministicReflectorOutput({
            userInput: 'summarize this',
            stepResults: [{ stepId: 's1', toolResults: [{ toolName: 'x', ok: true }] }],
        });

        expect(output).toEqual({
            isComplete: true,
            reason: 'All planned steps executed',
            missingItems: [],
        });
    });

    it('surfaces tool-error completion reason when a failed tool result exists', () => {
        const output = buildDeterministicReflectorOutput({
            userInput: 'summarize this',
            stepResults: [{ stepId: 's1', toolResults: [{ toolName: 'x', ok: false }] }],
        });

        expect(output).toEqual({
            isComplete: true,
            reason: 'Completed with tool errors',
            missingItems: [],
        });
    });
});
