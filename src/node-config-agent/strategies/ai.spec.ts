// Vitest specs for the AI node configuration strategy.
import { describe, expect, it } from 'vitest';
import { AiGenerateNodeStrategy } from './ai';

describe('ai node strategy', () => {
    it('exposes the expected strategy id and validation rules', () => {
        const strategy = new AiGenerateNodeStrategy();

        expect(strategy.strategyId).toBe('ai-generation');
        expect(
            strategy.validate?.({
                id: 'ai-node',
                blockId: 'ai-generate',
                label: 'AI Node',
                config: {},
                inputPorts: [],
                outputPorts: [],
            }),
        ).toEqual(
            expect.arrayContaining([
                expect.stringContaining('model configuration'),
                expect.stringContaining('jsonOutput'),
            ]),
        );
    });
});
