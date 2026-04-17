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
                expect.stringContaining('systemPrompt'),
                expect.stringContaining('promptTemplate'),
            ]),
        );
    });

    it('populates fallback system and prompt config for the AI node', async () => {
        const strategy = new AiGenerateNodeStrategy();

        const result = await strategy.apply(
            {
                id: 'ai-node',
                blockId: 'ai-generate',
                label: 'AI Node',
                config: {},
                inputPorts: [],
                outputPorts: [],
            },
            {
                flow: { blocks: [], nodes: [], edges: [] },
                input: {
                    userRequest: '입력한 텍스트에서 자음 개수를 찾아서 JSON으로 보여줘',
                    flow: { blocks: [], nodes: [], edges: [] },
                    desiredCount: 1,
                    wantsJson: true,
                },
                probeInsightsApplied: [],
            },
        );

        expect(result.suggestion?.config).toEqual(
            expect.objectContaining({
                model: 'fake-main',
                jsonOutput: 'true',
                systemPrompt: expect.stringContaining('JSON'),
                promptTemplate: expect.stringContaining(
                    'User request: 입력한 텍스트에서 자음 개수를 찾아서 JSON으로 보여줘',
                ),
                outputSchema: expect.stringContaining('type: object'),
            }),
        );
    });

    it('does not force a plain-text prompt template when output format was not explicitly requested', async () => {
        const strategy = new AiGenerateNodeStrategy();

        const result = await strategy.apply(
            {
                id: 'ai-node',
                blockId: 'ai-generate',
                label: 'AI Node',
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

        expect(result.suggestion?.config.promptTemplate).toContain('Return one result.');
        expect(result.suggestion?.config.promptTemplate).not.toContain('Return plain text.');
    });
});
