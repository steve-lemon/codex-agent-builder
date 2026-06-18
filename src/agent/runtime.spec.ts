// Vitest specs for core runtime behaviors.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AgentRuntime } from './runtime';
import { FakeLlmGateway } from '../llm/fake-gateway';
import { InMemoryRunStateStore } from '../state/memory-store';
import { ToolRegistry } from '../tools';
import { buildDefaultToolRegistry } from '../tools';
import type { LlmGateway } from '../llm/types';
import { now } from '../tools/now';
import { CallbackFlowDesignConnection, type FlowDesignEvent } from '../flow/design-monitor';
import { CallbackUnifiedRunEventConnection, type UnifiedRunEvent } from '../observability/unified-timeline';
import { getFlowDesignDetails, getNodeConfigurationDetails } from './design-details';
import {
    getFlowDesignerPayload,
    getFlowPreflightValidatorPayload,
    getNodeConfigDesignerPayload,
} from './final-result-payload';

async function buildDefaultRuntime() {
    return new AgentRuntime({
        llm: new FakeLlmGateway(),
        store: new InMemoryRunStateStore(),
        toolRegistry: await buildDefaultToolRegistry(),
    });
}

describe('runtime flow', () => {
    it('completes planner/executor/reflector/finalizer flow with fake gateway', async () => {
        const runtime = await buildDefaultRuntime();
        const result = await runtime.run('Review customer issue and summarize');

        expect(result.status).toBe('completed');
        expect(result.finalResult).toBeDefined();
        expect(result.finalResult?.summary).toContain('customer-support-reviewer');
        expect(Array.isArray(result.finalResult?.nextActions)).toBe(true);
        expect(result.trace.some(event => event.type === 'planner_llm_start')).toBe(true);
        expect(result.trace.some(event => event.type === 'planner_validation_end')).toBe(true);
    });

    it('completes a flow-designer skill run with the bundled flow-design tools', async () => {
        const store = new InMemoryRunStateStore();
        const runtime = new AgentRuntime({
            llm: new FakeLlmGateway(),
            store,
            toolRegistry: await buildDefaultToolRegistry(),
        });
        const result = await runtime.run('키워드를 줄테니 블로그 타이틀 여러개 만들기');
        const run = await store.get(result.runId);

        expect(result.status).toBe('completed');
        expect(result.finalResult?.summary).toContain('flow-designer');
        expect(result.finalResult?.summary).toContain('design pass');
        expect(result.finalResult?.summary).toContain('configured node');
        expect(result.finalResult?.summary).toContain('probe insight');
        expect(getFlowDesignerPayload(result.finalResult?.payload)).toEqual(
            expect.objectContaining({
                feasible: true,
                designPassCount: 3,
                taskGraphRefinementCount: 2,
            }),
        );
        expect(result.finalResult?.designDetails?.flowDesign).toEqual(
            expect.objectContaining({
                improvements: expect.any(Array),
                feasible: true,
                designPassCount: expect.any(Number),
                taskGraphRefinementCount: expect.any(Number),
            }),
        );
        expect(result.finalResult?.designDetails?.nodeConfiguration).toEqual(
            expect.objectContaining({
                improvements: expect.any(Array),
                appliedStrategies: expect.arrayContaining(['system-input', 'prompt-input', 'ai-generation']),
                nodeStrategyAssignments: expect.arrayContaining([
                    expect.objectContaining({ nodeId: 'system-input', strategyId: 'system-input' }),
                    expect.objectContaining({ nodeId: 'prompt-input', strategyId: 'prompt-input' }),
                    expect.objectContaining({ nodeId: 'ai-node', strategyId: 'ai-generation' }),
                ]),
                configuredNodeCount: expect.any(Number),
                probeInsightCount: expect.any(Number),
            }),
        );
        expect((result.finalResult?.designDetails?.nodeConfiguration?.configuredNodeCount ?? 0) >= 3).toBe(true);
        expect((result.finalResult?.designDetails?.nodeConfiguration?.probeInsightCount ?? 0) >= 1).toBe(true);
        expect(
            run?.stepResults.some(step => JSON.stringify(step).includes('"toolName":"prevalidateFlowDesignRequest"')),
        ).toBe(true);
        expect(
            run?.stepResults.filter(step => JSON.stringify(step).includes('"toolName":"designFlowDraft"')).length,
        ).toBe(3);
        expect(
            run?.stepResults.filter(step => JSON.stringify(step).includes('"toolName":"designFlowNodeConfigurations"'))
                .length,
        ).toBe(3);
        expect(
            run?.stepResults.filter(step =>
                JSON.stringify(step).includes('"toolName":"validateFlowNodeConfigurations"'),
            ).length,
        ).toBe(3);
        expect(
            run?.stepResults.filter(step => JSON.stringify(step).includes('"toolName":"reflectFlowResult"')).length,
        ).toBe(3);
        expect(
            run?.stepResults.filter(step => JSON.stringify(step).includes('"toolName":"refineTaskGraph"')).length,
        ).toBe(2);
        expect(result.finalResult?.summary).toContain('3 design pass(es)');
        expect(result.finalResult?.summary).toContain('2 task-graph refinement step(s)');
    });

    it('completes a node-config-designer skill run with sub-agent guidance', async () => {
        const runtime = await buildDefaultRuntime();
        const result = await runtime.run('ai 노드의 시스템 프롬프트와 모델 설정을 디자인해줘');

        expect(result.status).toBe('completed');
        expect(result.finalResult?.summary).toContain('node-config-designer');
        expect(result.finalResult?.nextActions).toEqual(
            expect.arrayContaining([expect.stringContaining('designFlowNodeConfigurations')]),
        );
        expect(getNodeConfigDesignerPayload(result.finalResult?.payload)).toEqual(
            expect.objectContaining({
                requiresExistingFlowDraft: true,
                suggestedNextTools: expect.arrayContaining(['designFlowNodeConfigurations']),
            }),
        );
        expect(getNodeConfigurationDetails(result.finalResult?.designDetails).improvements).toEqual(
            expect.arrayContaining([expect.stringContaining('sub-agent')]),
        );
    });

    it('stops early and reports missing capabilities when the request cannot be satisfied by available blocks', async () => {
        const runtime = await buildDefaultRuntime();
        const result = await runtime.run('이메일을 확인해서 답장 해줘');

        expect(result.status).toBe('completed');
        expect(result.finalResult).toEqual(
            expect.objectContaining({
                success: false,
                summary: expect.stringContaining('missing: email-read, email-reply'),
                nextActions: expect.arrayContaining([expect.stringContaining('email-read')]),
                designDetails: expect.objectContaining({
                    flowDesign: expect.objectContaining({
                        feasible: false,
                        missingCapabilities: expect.arrayContaining(['email-read', 'email-reply']),
                    }),
                }),
            }),
        );
        expect(getFlowDesignerPayload(result.finalResult?.payload)).toEqual(
            expect.objectContaining({
                feasible: false,
                missingCapabilities: ['email-read', 'email-reply'],
            }),
        );
    });

    it('streams live design graph events through the runtime when flow-designer tools execute', async () => {
        const events: FlowDesignEvent[] = [];
        const runtime = new AgentRuntime({
            llm: new FakeLlmGateway(),
            store: new InMemoryRunStateStore(),
            toolRegistry: await buildDefaultToolRegistry(),
            flowDesignConnectionFactory: ({ skillName }) =>
                skillName === 'flow-designer'
                    ? new CallbackFlowDesignConnection(event => {
                          events.push(event);
                      })
                    : undefined,
        });

        const result = await runtime.run('키워드를 줄테니 블로그 타이틀 여러개 만들기');

        expect(result.status).toBe('completed');
        expect(events.some(event => event.type === 'graph_started')).toBe(true);
        expect(events.some(event => event.type === 'node_created')).toBe(true);
        expect(events.some(event => event.type === 'edge_created')).toBe(true);
        expect(events.some(event => event.type === 'graph_completed')).toBe(true);
        expect(
            events.filter(event => event.type === 'graph_started' && event.data?.toolName === 'designFlowDraft').length,
        ).toBeGreaterThanOrEqual(1);
    });

    it('can stream trace and flow-design events into one unified runtime timeline', async () => {
        const timeline: UnifiedRunEvent[] = [];
        const runtime = new AgentRuntime({
            llm: new FakeLlmGateway(),
            store: new InMemoryRunStateStore(),
            toolRegistry: await buildDefaultToolRegistry(),
            unifiedEventConnectionFactory: () =>
                new CallbackUnifiedRunEventConnection(event => {
                    timeline.push(event);
                }),
        });

        const result = await runtime.run('키워드를 줄테니 블로그 타이틀 여러개 만들기');

        expect(result.status).toBe('completed');
        expect(timeline.some(event => event.source === 'trace' && event.type === 'skill_selected')).toBe(true);
        expect(timeline.some(event => event.source === 'trace' && event.type === 'tool_start')).toBe(true);
        expect(timeline.some(event => event.source === 'flow-design' && event.type === 'graph_started')).toBe(true);
        expect(timeline.some(event => event.source === 'flow-design' && event.type === 'node_created')).toBe(true);
        expect(timeline.some(event => event.source === 'flow-design' && event.type === 'graph_completed')).toBe(true);
        expect(timeline.every((event, index) => event.seq === index + 1)).toBe(true);
    });

    it('can stream diagnostic logger events into the unified runtime timeline', async () => {
        const originalDebugLogs = process.env.CODEX_DEBUG_LOGS;
        process.env.CODEX_DEBUG_LOGS = '1';
        try {
            const timeline: UnifiedRunEvent[] = [];
            const runtime = new AgentRuntime({
                llm: new FakeLlmGateway(),
                store: new InMemoryRunStateStore(),
                toolRegistry: await buildDefaultToolRegistry(),
                unifiedEventConnectionFactory: () =>
                    new CallbackUnifiedRunEventConnection(event => {
                        timeline.push(event);
                    }),
            });

            const result = await runtime.run('키워드를 줄테니 블로그 타이틀 여러개 만들기');

            expect(result.status).toBe('completed');
            expect(
                timeline.some(
                    event =>
                        event.source === 'trace' &&
                        event.type === 'diagnostic_debug' &&
                        typeof event.message === 'string' &&
                        event.message.includes('flow-design'),
                ),
            ).toBe(true);
        } finally {
            if (typeof originalDebugLogs === 'undefined') {
                delete process.env.CODEX_DEBUG_LOGS;
            } else {
                process.env.CODEX_DEBUG_LOGS = originalDebugLogs;
            }
        }
    });

    it('completes a preflight validation run and returns task-graph feasibility feedback', async () => {
        const runtime = await buildDefaultRuntime();
        const result = await runtime.run('이 요청이 가능한지 사전 검증해줘: 이메일을 확인해서 답장 해줘');

        expect(result.status).toBe('completed');
        expect(result.finalResult).toEqual(
            expect.objectContaining({
                success: false,
                summary: expect.stringContaining('flow-preflight-validator'),
                nextActions: expect.arrayContaining([expect.stringContaining('email-read-block')]),
                designDetails: expect.objectContaining({
                    flowDesign: expect.objectContaining({
                        improvements: expect.any(Array),
                        feasible: false,
                        missingCapabilities: expect.arrayContaining(['email-read', 'email-reply']),
                    }),
                }),
            }),
        );
        expect(getFlowPreflightValidatorPayload(result.finalResult?.payload)).toEqual(
            expect.objectContaining({
                feasible: false,
                missingCapabilities: ['email-read', 'email-reply'],
                proposedBlockIds: expect.arrayContaining(['email-read-block']),
            }),
        );
        expect(getNodeConfigurationDetails(result.finalResult?.designDetails).improvements).toEqual([]);
    });

    it('runs parallel-safe tools concurrently in parallel step', async () => {
        const registry = new ToolRegistry();
        const timeline: Array<{ name: string; ts: number }> = [];

        registry.registerMany([
            {
                name: 'getCustomerById',
                description: 'A',
                parameters: z.object({ customerId: z.string() }),
                riskLevel: 'read-only',
                allowedSkills: ['customer-support-reviewer'],
                requiresConfirmation: false,
                parallelSafe: true,
                execute: async () => {
                    timeline.push({ name: 'getCustomerById:start', ts: now() });
                    await new Promise(r => setTimeout(r, 120));
                    timeline.push({ name: 'getCustomerById:end', ts: now() });
                    return { ok: true };
                },
            },
            {
                name: 'getOrdersByCustomer',
                description: 'B',
                parameters: z.object({ customerId: z.string() }),
                riskLevel: 'read-only',
                allowedSkills: ['customer-support-reviewer'],
                requiresConfirmation: false,
                parallelSafe: true,
                execute: async () => {
                    timeline.push({ name: 'getOrdersByCustomer:start', ts: now() });
                    await new Promise(r => setTimeout(r, 120));
                    timeline.push({ name: 'getOrdersByCustomer:end', ts: now() });
                    return { ok: true };
                },
            },
            {
                name: 'getRefundPolicy',
                description: 'C',
                parameters: z.object({}),
                riskLevel: 'read-only',
                allowedSkills: ['customer-support-reviewer'],
                requiresConfirmation: false,
                parallelSafe: true,
                execute: async () => ({ ok: true }),
            },
        ]);

        const llm: LlmGateway = {
            plan: async () => ({
                steps: [
                    {
                        id: 'p1',
                        mode: 'parallel-tools',
                        description: 'parallel read',
                        toolCalls: [
                            { toolName: 'getCustomerById', args: { customerId: 'c_1' } },
                            { toolName: 'getOrdersByCustomer', args: { customerId: 'c_1' } },
                        ],
                    },
                    { id: 'f', mode: 'finalize', description: 'done' },
                ],
            }),
            reflect: async () => ({ isComplete: true, reason: 'ok', missingItems: [] }),
            finalize: async () => ({ summary: 'done', success: true, nextActions: [] }),
            generateStructured: async () => {
                throw new Error('unused generateStructured mock');
            },
        };

        const runtime = new AgentRuntime({
            llm,
            store: new InMemoryRunStateStore(),
            toolRegistry: registry,
        });

        const started = now();
        const result = await runtime.run('customer question');
        const duration = now() - started;

        expect(result.status).toBe('completed');
        expect(duration).toBeLessThan(230);

        const aStart = timeline.find(x => x.name === 'getCustomerById:start')!.ts;
        const bStart = timeline.find(x => x.name === 'getOrdersByCustomer:start')!.ts;
        expect(Math.abs(aStart - bStart)).toBeLessThan(40);
    });

    it('final result contains expected structured fields', async () => {
        const runtime = await buildDefaultRuntime();
        const result = await runtime.run('Prepare a quick customer summary');
        expect(result.finalResult).toEqual(
            expect.objectContaining({
                summary: expect.any(String),
                success: expect.any(Boolean),
                nextActions: expect.any(Array),
                designDetails: expect.objectContaining({
                    flowDesign: expect.objectContaining({
                        improvements: expect.any(Array),
                    }),
                    nodeConfiguration: expect.objectContaining({
                        improvements: expect.any(Array),
                    }),
                }),
            }),
        );
        expect(getFlowDesignDetails(result.finalResult?.designDetails)).toEqual(
            result.finalResult?.designDetails?.flowDesign,
        );
        expect(getNodeConfigurationDetails(result.finalResult?.designDetails)).toEqual(
            result.finalResult?.designDetails?.nodeConfiguration,
        );
    });

    it('resolves step-result references into concrete tool args at execution time', async () => {
        const registry = new ToolRegistry();
        const capturedArgs: Array<{ customerId?: string; message?: string }> = [];

        registry.registerMany([
            {
                name: 'getCustomerById',
                description: 'lookup',
                parameters: z.object({ customerId: z.string() }),
                riskLevel: 'read-only',
                allowedSkills: ['customer-support-reviewer'],
                requiresConfirmation: false,
                parallelSafe: true,
                execute: async ({ customerId }) => {
                    capturedArgs.push({ customerId });
                    return { message: `customer:${customerId}` };
                },
            },
            {
                name: 'createMessage',
                description: 'message tool',
                parameters: z.object({ message: z.string() }),
                riskLevel: 'read-only',
                allowedSkills: ['customer-support-reviewer'],
                requiresConfirmation: false,
                parallelSafe: true,
                execute: async ({ message }) => {
                    capturedArgs.push({ message });
                    return { echoed: message };
                },
            },
        ]);

        const llm: LlmGateway = {
            plan: async () => ({
                steps: [
                    {
                        id: 's1',
                        mode: 'single-tool',
                        description: 'lookup customer',
                        toolCalls: [{ toolName: 'getCustomerById', args: { customerId: 'c_1' } }],
                    },
                    {
                        id: 's2',
                        mode: 'single-tool',
                        description: 'reuse prior result',
                        toolCalls: [
                            {
                                toolName: 'createMessage',
                                args: {
                                    message: { $fromStep: 's1', path: 'toolResults.0.data.message' },
                                },
                            },
                        ],
                    },
                    { id: 's3', mode: 'finalize', description: 'done' },
                ],
            }),
            reflect: async () => ({ isComplete: true, reason: 'ok', missingItems: [] }),
            finalize: async () => ({ summary: 'done', success: true, nextActions: [] }),
            generateStructured: async () => {
                throw new Error('unused generateStructured mock');
            },
        };

        const runtime = new AgentRuntime({
            llm,
            store: new InMemoryRunStateStore(),
            toolRegistry: registry,
        });

        const result = await runtime.run('Help me review this customer complaint');

        expect(result.status).toBe('completed');
        expect(capturedArgs).toEqual([{ customerId: 'c_1' }, { message: 'customer:c_1' }]);
    });

    it('fails the run when a single-tool step has no tool calls', async () => {
        const llm: LlmGateway = {
            plan: async () => ({
                steps: [
                    { id: 'bad-step', mode: 'single-tool', description: 'missing tool call' },
                    { id: 'f', mode: 'finalize', description: 'done' },
                ],
            }),
            reflect: async () => ({ isComplete: true, reason: 'ok', missingItems: [] }),
            finalize: async () => ({ summary: 'done', success: true, nextActions: [] }),
            generateStructured: async () => {
                throw new Error('unused generateStructured mock');
            },
        };

        const runtime = new AgentRuntime({
            llm,
            store: new InMemoryRunStateStore(),
            toolRegistry: await buildDefaultToolRegistry(),
        });

        const result = await runtime.run('customer question');

        expect(result.status).toBe('failed');
        expect(result.trace.some(event => event.type === 'error')).toBe(true);
    });

    it('rejects the run when planner returns a tool not allowed for the selected skill', async () => {
        const llm: LlmGateway = {
            plan: async () => ({
                steps: [
                    {
                        id: 'bad-step',
                        mode: 'single-tool',
                        description: 'attempt disallowed tool',
                        toolCalls: [{ toolName: 'webSearch', args: { query: 'leak' } }],
                    },
                    { id: 'f', mode: 'finalize', description: 'done' },
                ],
            }),
            reflect: async () => ({ isComplete: true, reason: 'ok', missingItems: [] }),
            finalize: async () => ({ summary: 'done', success: true, nextActions: [] }),
            generateStructured: async () => {
                throw new Error('unused generateStructured mock');
            },
        };

        const runtime = new AgentRuntime({
            llm,
            store: new InMemoryRunStateStore(),
            toolRegistry: await buildDefaultToolRegistry(),
        });

        await expect(runtime.run('Please review this customer complaint.')).rejects.toThrow(
            /Planner returned tool webSearch that is not available in this run/,
        );
    });

    it('rejects the run before execution when planner returns args that violate the tool schema', async () => {
        const llm: LlmGateway = {
            plan: async () => ({
                steps: [
                    {
                        id: 'bad-args',
                        mode: 'single-tool',
                        description: 'attempt invalid args',
                        toolCalls: [{ toolName: 'refundOrder', args: { orderId: 'o_100', amount: '25' } }],
                    },
                    { id: 'f', mode: 'finalize', description: 'done' },
                ],
            }),
            reflect: async () => ({ isComplete: true, reason: 'ok', missingItems: [] }),
            finalize: async () => ({ summary: 'done', success: true, nextActions: [] }),
            generateStructured: async () => {
                throw new Error('unused generateStructured mock');
            },
        };

        const runtime = new AgentRuntime({
            llm,
            store: new InMemoryRunStateStore(),
            toolRegistry: await buildDefaultToolRegistry(),
        });

        await expect(runtime.run('Please refund this customer order now.')).rejects.toThrow(
            /Planner returned invalid args for refundOrder/,
        );
    });

    it('fails the run when a parallel step includes a non parallel-safe tool', async () => {
        const llm: LlmGateway = {
            plan: async () => ({
                steps: [
                    {
                        id: 'bad-parallel',
                        mode: 'parallel-tools',
                        description: 'mix safe and unsafe tools',
                        toolCalls: [
                            { toolName: 'getCustomerById', args: { customerId: 'c_1' } },
                            {
                                toolName: 'createTicket',
                                args: { customerId: 'c_1', reason: 'should not run in parallel' },
                            },
                        ],
                    },
                    { id: 'f', mode: 'finalize', description: 'done' },
                ],
            }),
            reflect: async () => ({ isComplete: true, reason: 'ok', missingItems: [] }),
            finalize: async () => ({ summary: 'done', success: true, nextActions: [] }),
            generateStructured: async () => {
                throw new Error('unused generateStructured mock');
            },
        };

        const runtime = new AgentRuntime({
            llm,
            store: new InMemoryRunStateStore(),
            toolRegistry: await buildDefaultToolRegistry(),
        });

        const result = await runtime.run('Please review this customer complaint.');

        expect(result.status).toBe('failed');
        expect(
            result.trace.some(
                event =>
                    event.type === 'error' &&
                    String(event.data?.message).includes(
                        'parallel-tools step includes non parallel-safe/read-only tools: createTicket',
                    ),
            ),
        ).toBe(true);
    });
});
