// Vitest specs for input-node configuration strategies.
import { describe, expect, it } from 'vitest';
import { PromptInputNodeStrategy, SystemInputNodeStrategy } from './input';
import type { DesignBrief } from '../../../design/types';

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

    it('injects architecture mission and validation hints into input prompts', async () => {
        const promptStrategy = new PromptInputNodeStrategy();
        const systemStrategy = new SystemInputNodeStrategy();
        const designBrief: DesignBrief = {
            mission: {
                summary: 'Explain what the provided graph JSON is doing.',
                goal: '그래프 json 설명',
                operationModel: ['explain'],
            },
            inputContract: {
                format: 'json',
                source: 'synthetic',
                concreteInputPresent: false,
                missingRequiredInput: true,
                notes: [],
            },
            outputContract: {
                format: 'markdown',
                structured: false,
                cardinality: 'single',
            },
            executionPosture: {
                strategy: 'ai-first',
                rationale: ['Explanation quality depends on structural interpretation.'],
            },
            successCriteria: ['Cover structure and purpose.'],
            validationPlan: {
                sampleCases: [],
                assertions: ['Cover major nodes and edges.'],
                confidenceCeiling: 'uncertain',
            },
            designPrinciples: ['Keep explanations grounded in structure.'],
            riskFlags: [],
            strategicAssumptions: [],
            knowledgeReferences: [],
        };

        const systemResult = await systemStrategy.apply(
            {
                id: 'system-input',
                blockId: 'input',
                label: 'System Input',
                config: {},
                inputPorts: [],
                outputPorts: [],
            },
            {
                flow: { blocks: [], nodes: [], edges: [] },
                input: {
                    userRequest: '그래프(json)를 보고 이게 뭐하는 것인지 설명(md) 해줘',
                    flow: { blocks: [], nodes: [], edges: [] },
                    desiredCount: 1,
                    wantsJson: false,
                    designBrief,
                },
                probeInsightsApplied: [],
            },
        );
        const promptResult = await promptStrategy.apply(
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
                    userRequest: '그래프(json)를 보고 이게 뭐하는 것인지 설명(md) 해줘',
                    flow: { blocks: [], nodes: [], edges: [] },
                    desiredCount: 1,
                    wantsJson: false,
                    designBrief,
                },
                probeInsightsApplied: [],
            },
        );

        expect(systemResult.suggestion?.config.input).toContain('Explain what the provided graph JSON is doing.');
        expect(promptResult.suggestion?.config.input).toContain('Validation targets: Cover major nodes and edges.');
    });
});
