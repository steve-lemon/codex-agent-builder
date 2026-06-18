import { describe, expect, it } from 'vitest';
import { analyzeTaskGraph, assessFlowFeasibility, assessTaskGraphFeasibility } from './analysis';
import type { FlowAiDelegationAdvisor } from './ai-delegation';

describe('flow design analysis', () => {
    it('treats AI-delegable text processing capabilities as satisfiable by ai-generate', async () => {
        const graph = {
            nodes: [
                {
                    id: 'count-korean-letters',
                    label: 'Count Korean Letters',
                    data: {
                        operation: 'count-text',
                        requiredCapabilities: ['hangul-decomposition'],
                        expectedInputs: ['user text'],
                        expectedOutputs: ['count summary'],
                    },
                },
            ],
            edges: [],
        };

        const analyses = await analyzeTaskGraph(graph);

        expect(analyses[0]).toEqual(
            expect.objectContaining({
                feasible: true,
                resolvedByAiDelegation: true,
                matchedBlockIds: ['ai-generate'],
            }),
        );

        const feasibility = await assessTaskGraphFeasibility('자음과 모음의 개수를 분리해', graph);
        expect(feasibility.feasible).toBe(true);
        expect(feasibility.missingCapabilities).not.toContain('hangul-decomposition');
    });

    it('does not delegate external-system capabilities to ai-generate', async () => {
        const graph = {
            nodes: [
                {
                    id: 'email-read',
                    label: 'Read Email',
                    data: {
                        operation: 'analyze-email',
                        requiredCapabilities: ['email-read'],
                        expectedInputs: ['mailbox connection'],
                        expectedOutputs: ['email body'],
                    },
                },
            ],
            edges: [],
        };

        const analyses = await analyzeTaskGraph(graph);
        expect(analyses[0]?.resolvedByAiDelegation).not.toBe(true);

        const feasibility = await assessTaskGraphFeasibility('이메일을 읽어서 분석해줘', graph);
        expect(feasibility.feasible).toBe(false);
        expect(feasibility.missingCapabilities).toContain('email-read');
    });

    it('lets an injected advisor decide ai delegation before deterministic fallback', async () => {
        const graph = {
            nodes: [
                {
                    id: 'count-korean-letters',
                    label: 'Count Korean Letters',
                    data: {
                        operation: 'count-text',
                        requiredCapabilities: ['hangul-decomposition'],
                        expectedInputs: ['user text'],
                        expectedOutputs: ['count summary'],
                    },
                },
            ],
            edges: [],
        };
        const advisor: FlowAiDelegationAdvisor = {
            async recommend() {
                return {
                    delegable: false,
                    rationale: 'Lite model decided this task should not be delegated.',
                    source: 'model',
                };
            },
        };

        const analyses = await analyzeTaskGraph(graph, {
            userRequest: '자음과 모음의 개수를 분리해',
            aiDelegationAdvisor: advisor,
        });

        expect(analyses[0]).toEqual(
            expect.objectContaining({
                feasible: false,
                resolvedByAiDelegation: false,
            }),
        );
        expect(analyses[0]?.reasons[0]).toContain('No block currently provides any of the required capabilities');
    });

    it('uses deterministic fast-path prevalidation before model-backed task-graph inference for strong matches', async () => {
        const explodingTaskGraphAdvisor = {
            async recommend() {
                throw new Error('model-backed task-graph advisor should not be called for fast-path requests');
            },
        };

        const feasibility = await assessFlowFeasibility('그래프(json)를 보고 이게 뭐하는 것인지 설명(md) 해줘', {
            taskGraphAdvisor: explodingTaskGraphAdvisor as any,
        });

        expect(feasibility.feasible).toBe(true);
        expect(feasibility.taskGraph.nodes.map(node => node.id)).toEqual([
            'capture-graph-json',
            'explain-graph',
            'review-output',
        ]);
    });
});
