// Vitest specs for the node-configuration design sub-agent.
import { describe, expect, it } from 'vitest';
import { buildDefaultToolRegistry } from '../tools';
import { NodeConfigDesignAgent } from './agent';
import { createDefaultNodeBlockConfigStrategies } from './strategies';

describe('node-config design agent', () => {
    it('uses block-specific strategy objects for the default configuration pass', () => {
        const strategies = createDefaultNodeBlockConfigStrategies();
        const strategyNames = strategies.map(strategy => strategy.constructor.name);
        const strategyIds = strategies.map(strategy => strategy.strategyId);

        expect(strategyNames).toEqual([
            'SystemInputNodeStrategy',
            'PromptInputNodeStrategy',
            'AiGenerateNodeStrategy',
            'BufferNodeStrategy',
            'ViewNodeStrategy',
        ]);
        expect(strategyIds).toEqual([
            'system-input',
            'prompt-input',
            'ai-generation',
            'buffer-timing',
            'view-observer',
        ]);
    });

    it('applies blog-title prompts and a blog-focused model to a generated flow draft', async () => {
        const registry = buildDefaultToolRegistry();
        const design = await registry.execute(
            {
                toolName: 'designFlowDraft',
                args: {
                    userRequest: '키워드를 줄테니 블로그 타이틀 여러개 만들기',
                    sampleInput: '생산성 향상',
                    desiredCount: 5,
                    wantsJson: false,
                },
            },
            {
                runId: 'node-config-agent-1',
                now: 1234567890,
                runState: {
                    async get() {
                        throw new Error('runState.get() should not be called in this test');
                    },
                },
            },
        );

        const agent = new NodeConfigDesignAgent();
        const result = agent.design({
            userRequest: '키워드를 줄테니 블로그 타이틀 여러개 만들기',
            flow: (design.data as { flow: Parameters<NodeConfigDesignAgent['design']>[0]['flow'] }).flow,
            desiredCount: 5,
            wantsJson: false,
            strategyNotes: [
                'Strengthen the system-input node to emphasize publishable headline quality and distinct title phrasing.',
            ],
            probeResult: {
                blockId: 'ai-generate',
                behaviorNotes: ['Reads system/prompt text and writes the mock generation result into the output port.'],
                mismatchesFromSpec: [
                    'The output port can emit structured object payloads when jsonOutput=true, but the description does not explain that.',
                ],
            },
        });

        expect(result.summary).toContain('Configured');
        expect(result.summary).toContain('probe insight');
        expect(result.probeInsightsApplied).toHaveLength(2);
        expect(result.appliedStrategyIds).toEqual(
            expect.arrayContaining(['system-input', 'prompt-input', 'ai-generation', 'view-observer']),
        );
        expect(result.nodeStrategyAssignments).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ nodeId: 'system-input', strategyId: 'system-input' }),
                expect.objectContaining({ nodeId: 'prompt-input', strategyId: 'prompt-input' }),
                expect.objectContaining({ nodeId: 'ai-node', strategyId: 'ai-generation' }),
            ]),
        );
        expect(result.suggestions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    nodeId: 'system-input',
                    strategyId: 'system-input',
                    config: expect.objectContaining({
                        input: expect.stringContaining('You generate clear and catchy blog titles'),
                    }),
                    rationale: expect.arrayContaining([
                        expect.stringContaining('observed block behavior'),
                        expect.stringContaining('Apply strategy guidance'),
                    ]),
                }),
                expect.objectContaining({
                    nodeId: 'prompt-input',
                    strategyId: 'prompt-input',
                    config: expect.objectContaining({
                        input: expect.stringMatching(/Return exactly 5 results\..*Strategy notes:/),
                    }),
                }),
                expect.objectContaining({
                    nodeId: 'ai-node',
                    strategyId: 'ai-generation',
                    config: expect.objectContaining({
                        model: 'mock-blog-gpt',
                        jsonOutput: 'false',
                    }),
                }),
            ]),
        );
    });

    it('uses structured output configuration for json-oriented requests', async () => {
        const registry = buildDefaultToolRegistry();
        const design = await registry.execute(
            {
                toolName: 'designFlowDraft',
                args: {
                    userRequest: '상품 소개 문구를 JSON 형태로 여러개 만들어줘',
                    sampleInput: '생산성 향상',
                    desiredCount: 3,
                    wantsJson: true,
                },
            },
            {
                runId: 'node-config-agent-2',
                now: 1234567890,
                runState: {
                    async get() {
                        throw new Error('runState.get() should not be called in this test');
                    },
                },
            },
        );

        const agent = new NodeConfigDesignAgent();
        const result = agent.design({
            userRequest: '상품 소개 문구를 JSON 형태로 여러개 만들어줘',
            flow: (design.data as { flow: Parameters<NodeConfigDesignAgent['design']>[0]['flow'] }).flow,
            desiredCount: 3,
            wantsJson: true,
        });

        const aiSuggestion = result.suggestions.find(suggestion => suggestion.nodeId === 'ai-node');
        expect(aiSuggestion?.config).toEqual(
            expect.objectContaining({
                model: 'mock-structured-gpt',
                jsonOutput: 'true',
            }),
        );
    });

    it('reports validation issues when required prompts or ai settings are missing', async () => {
        const registry = buildDefaultToolRegistry();
        const design = await registry.execute(
            {
                toolName: 'designFlowDraft',
                args: {
                    userRequest: '키워드를 줄테니 블로그 타이틀 여러개 만들기',
                    sampleInput: '생산성 향상',
                    desiredCount: 5,
                    wantsJson: false,
                },
            },
            {
                runId: 'node-config-agent-3',
                now: 1234567890,
                runState: {
                    async get() {
                        throw new Error('runState.get() should not be called in this test');
                    },
                },
            },
        );

        const agent = new NodeConfigDesignAgent();
        const draftFlow = (design.data as { flow: Parameters<NodeConfigDesignAgent['validate']>[0] }).flow;
        const invalidFlow: Parameters<NodeConfigDesignAgent['validate']>[0] = {
            ...draftFlow,
            nodes: draftFlow.nodes.map(node =>
                node.id === 'system-input' || node.id === 'prompt-input' || node.id === 'ai-node'
                    ? { ...node, config: {} }
                    : node,
            ),
        };

        const result = agent.validate(invalidFlow);

        expect(result.isValid).toBe(false);
        expect(result.issues).toEqual(
            expect.arrayContaining([
                expect.stringContaining('Input node is missing prompt text'),
                expect.stringContaining('AI node is missing a model configuration'),
                expect.stringContaining('AI node is missing a jsonOutput configuration'),
            ]),
        );
    });
});
