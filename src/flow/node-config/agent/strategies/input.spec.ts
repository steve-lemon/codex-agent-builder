// Vitest specs for input-node configuration strategies.
import { describe, expect, it } from 'vitest';
import { PromptInputNodeStrategy, SystemInputNodeStrategy } from './input';

describe('input node strategies', () => {
    it('system strategy targets only the system-input node', () => {
        const strategy = new SystemInputNodeStrategy();

        expect(strategy.strategyId).toBe('system-input');
        expect(
            strategy.supports?.({
                id: 'system-input',
                blockId: 'input',
                label: 'System Input',
                config: {},
                inputPorts: [],
                outputPorts: [],
            }),
        ).toBe(true);
        expect(
            strategy.supports?.({
                id: 'prompt-input',
                blockId: 'input',
                label: 'Prompt Input',
                config: {},
                inputPorts: [],
                outputPorts: [],
            }),
        ).toBe(false);
    });

    it('prompt strategy targets only the prompt-input node', () => {
        const strategy = new PromptInputNodeStrategy();

        expect(strategy.strategyId).toBe('prompt-input');
        expect(
            strategy.supports?.({
                id: 'prompt-input',
                blockId: 'input',
                label: 'Prompt Input',
                config: {},
                inputPorts: [],
                outputPorts: [],
            }),
        ).toBe(true);
        expect(
            strategy.supports?.({
                id: 'system-input',
                blockId: 'input',
                label: 'System Input',
                config: {},
                inputPorts: [],
                outputPorts: [],
            }),
        ).toBe(false);
    });

    it('does not force plain-text wording when the request did not explicitly ask for a text format', async () => {
        const strategy = new PromptInputNodeStrategy();

        const result = await strategy.apply(
            {
                id: 'prompt-input',
                blockId: 'input',
                label: 'Prompt Input',
                config: {},
                inputPorts: [],
                outputPorts: [],
            },
            {
                flow: { blocks: [], nodes: [], edges: [] },
                input: {
                    userRequest: '자음과 모음의 개수를 분리해',
                    flow: { blocks: [], nodes: [], edges: [] },
                    desiredCount: 1,
                    wantsJson: false,
                },
                probeInsightsApplied: [],
            },
        );

        expect(result.suggestion?.config.input).toContain('Return one result.');
        expect(result.suggestion?.config.input).not.toContain('Return plain text');
    });
});
