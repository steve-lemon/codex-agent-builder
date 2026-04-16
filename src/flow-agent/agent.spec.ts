// Vitest specs for the skill-based flow design agent.
import { describe, expect, it } from 'vitest';
import { AiGenerateBlock, InputBlock, ViewBlock } from '../flow/blocks';
import { CallbackFlowDesignConnection, type FlowDesignEvent } from '../flow/design-monitor';
import { FlowDesignAgent } from './agent';

describe('flow design agent', () => {
    it('designs, validates, and sample-executes a flow for a multi-title request', async () => {
        const agent = new FlowDesignAgent();

        const result = await agent.design('키워드를 줄테니 블로그 타이틀 여러개 만들기');

        expect(result.status).toBe('completed');
        expect(result.intent?.taskType).toBe('blog-title-generation');
        expect(result.validation?.isValid).toBe(true);
        expect(result.finalFlow?.nodes.map(node => node.id)).toEqual([
            'system-input',
            'prompt-input',
            'ai-node',
            'view-output',
        ]);
        expect(result.execution?.status).toBe('completed');
        expect(typeof result.execution?.output).toBe('string');
        expect(String(result.execution?.output)).toContain('블로그 타이틀');
        expect(result.reflection?.satisfied).toBe(true);
        expect(result.usedSkills).toEqual([
            'intent-analysis',
            'flow-composition',
            'flow-validation',
            'flow-execution',
            'flow-reflection',
            'flow-improvement',
        ]);
    });

    it('supports json-oriented requests and produces structured sample output', async () => {
        const agent = new FlowDesignAgent();

        const result = await agent.design('상품 소개 문구를 JSON 형태로 여러개 만들어줘');

        expect(result.status).toBe('completed');
        expect(result.intent?.wantsJson).toBe(true);
        expect(result.execution?.output).toMatchObject({
            model: 'mock-flow-model',
            items: expect.any(Array),
        });
        expect(Array.isArray((result.execution?.output as { items?: unknown[] }).items)).toBe(true);
        expect(result.reflection?.satisfied).toBe(true);
    });

    it('retries with self-improvement notes when the first sample run is insufficient', async () => {
        let callCount = 0;
        const agent = new FlowDesignAgent({
            maxIterations: 2,
            aiGenerate: async request => {
                callCount += 1;
                if (callCount === 1) {
                    return '하나의 타이틀만 반환';
                }

                return Array.from(
                    { length: request.improvementNotes.some(note => note.includes('exactly 5')) ? 5 : 2 },
                    (_, index) => `개선된 블로그 타이틀 ${index + 1}`,
                ).join('\n');
            },
        });

        const result = await agent.design('블로그 타이틀 여러개 만들어줘');

        expect(result.status).toBe('completed');
        expect(result.iterations).toHaveLength(2);
        expect(result.iterations[0]?.reflection?.satisfied).toBe(false);
        expect(result.iterations[1]?.improvementNotes).toContain('Ask for exactly 5 distinct results.');
        expect(result.reflection?.satisfied).toBe(true);
        expect(String(result.execution?.output)).toContain('개선된 블로그 타이틀 5');
    });

    it('fails clearly when required blocks are unavailable', async () => {
        const agent = new FlowDesignAgent({
            availableBlocks: [InputBlock, ViewBlock],
        });

        const result = await agent.design('블로그 타이틀 만들어줘');

        expect(result.status).toBe('failed');
        expect(result.error).toMatch(/Required flow block is not available/);
        expect(result.usedSkills).toContain('flow-composition');
        expect(result.finalFlow).toBeUndefined();
    });

    it('streams live graph design events while composing and retrying a flow', async () => {
        const events: FlowDesignEvent[] = [];
        const agent = new FlowDesignAgent({
            maxIterations: 2,
            designConnection: new CallbackFlowDesignConnection(event => {
                events.push(event);
            }),
            aiGenerate: async request => {
                if (request.iteration === 1) {
                    return '짧음';
                }
                return Array.from({ length: 5 }, (_, index) => `개선된 블로그 타이틀 ${index + 1}`).join('\n');
            },
        });

        const result = await agent.design('블로그 타이틀 여러개 만들어줘');

        expect(result.status).toBe('completed');
        expect(events[0]?.type).toBe('graph_started');
        expect(events.some(event => event.type === 'graph_cleared')).toBe(true);
        expect(events.some(event => event.type === 'node_staged')).toBe(true);
        expect(events.some(event => event.type === 'node_phase_changed')).toBe(true);
        expect(events.some(event => event.type === 'edge_created')).toBe(true);
        expect(events[events.length - 1]).toEqual(
            expect.objectContaining({
                type: 'graph_completed',
                data: expect.objectContaining({
                    status: 'completed',
                }),
            }),
        );
        expect(
            events.filter(event => event.type === 'node_created' && event.data?.node && (event.data.node as { id?: string }).id === 'ai-node')
                .length,
        ).toBeGreaterThanOrEqual(2);
    });
});
