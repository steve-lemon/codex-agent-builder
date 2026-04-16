// Vitest specs for core runtime behaviors.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildDefaultToolRegistry } from '.';
import { createFlowDesignTools } from './flow-tools';
import { createMockTools } from './mock-tools';
import { AnyArgsSchema, ToolRegistry } from './registry';
import { defineTool, type ToolDefinition } from './types';
import type { ToolContext } from './types';

function makeToolContext(runId = 'test-run'): ToolContext {
    return {
        runId,
        now: 1234567890,
        runState: {
            async get() {
                throw new Error('runState.get() should not have been called in this test');
            },
        },
    };
}

function makeTestTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
    return defineTool({
        name: 'echoTool',
        description: 'Echo args back to caller',
        parameters: z.object({ value: z.string() }),
        riskLevel: 'read-only',
        allowedSkills: ['customer-support-reviewer'],
        requiresConfirmation: false,
        parallelSafe: true,
        execute: async (args, context) => ({
            ...(args as Record<string, unknown>),
            runId: context.runId,
            now: context.now,
        }),
        ...overrides,
    });
}

describe('tools modules', () => {
    it('buildDefaultToolRegistry loads all mock tools into the registry', () => {
        const registry = buildDefaultToolRegistry();
        const toolNames = registry.list().map(tool => tool.name);

        expect(toolNames).toEqual([
            'getCustomerById',
            'getOrdersByCustomer',
            'getRefundPolicy',
            'webSearch',
            'createTicket',
            'sendSlackMessage',
            'refundOrder',
            'analyzeFlowRequest',
            'listAvailableFlowBlocks',
            'assessFlowFeasibility',
            'probeFlowBlock',
            'designFlowDraft',
            'validateFlowDraft',
            'proposeBlockSpecUpdate',
            'runFlowSample',
            'reflectFlowResult',
            'inferTaskGraph',
            'analyzeTaskGraphCompatibility',
            'proposeMissingBlocks',
            'prevalidateFlowDesignRequest',
        ]);
    });

    it('createMockTools returns metadata that matches policy expectations', () => {
        const tools = createMockTools();
        const refundTool = tools.find(tool => tool.name === 'refundOrder');
        const searchTool = tools.find(tool => tool.name === 'webSearch');
        const slackTool = tools.find(tool => tool.name === 'sendSlackMessage');

        expect(tools).toHaveLength(7);
        expect(refundTool).toEqual(
            expect.objectContaining({
                riskLevel: 'approval-required',
                requiresConfirmation: true,
                parallelSafe: false,
            }),
        );
        expect(searchTool).toEqual(
            expect.objectContaining({
                riskLevel: 'read-only',
                requiresConfirmation: false,
                parallelSafe: true,
            }),
        );
        expect(slackTool?.allowedSkills).toEqual(['ops-automation-agent']);
    });

    it('createFlowDesignTools returns planner-safe read-only tools for the flow-designer skill', () => {
        const tools = createFlowDesignTools();

        expect(tools).toHaveLength(9);
        expect(tools.map(tool => tool.name)).toEqual([
            'analyzeFlowRequest',
            'listAvailableFlowBlocks',
            'assessFlowFeasibility',
            'probeFlowBlock',
            'designFlowDraft',
            'validateFlowDraft',
            'proposeBlockSpecUpdate',
            'runFlowSample',
            'reflectFlowResult',
        ]);
        expect(tools.every(tool => tool.allowedSkills.includes('flow-designer'))).toBe(true);
        expect(tools.every(tool => tool.riskLevel === 'read-only')).toBe(true);
        expect(tools.every(tool => tool.requiresConfirmation === false)).toBe(true);
    });

    it('assessFlowFeasibility reports missing capabilities for impossible requests', async () => {
        const registry = buildDefaultToolRegistry();

        const result = await registry.execute(
            {
                toolName: 'assessFlowFeasibility',
                args: { userRequest: '이메일을 확인해서 답장 해줘' },
            },
            makeToolContext('flow-tools-gap'),
        );

        expect(result).toEqual({
            toolName: 'assessFlowFeasibility',
            ok: true,
            data: expect.objectContaining({
                feasible: false,
                missingCapabilities: ['email-read', 'email-reply'],
                recommendedAction: expect.stringContaining('email-read'),
                taskGraph: expect.objectContaining({
                    nodes: expect.arrayContaining([
                        expect.objectContaining({ id: 'email-read', label: 'Read Email' }),
                        expect.objectContaining({ id: 'draft-reply', label: 'Draft Reply' }),
                        expect.objectContaining({ id: 'send-reply', label: 'Send Reply' }),
                    ]),
                    edges: expect.arrayContaining([
                        expect.objectContaining({ source: 'email-read', target: 'draft-reply' }),
                        expect.objectContaining({ source: 'draft-reply', target: 'send-reply' }),
                    ]),
                }),
                nodeAnalyses: expect.arrayContaining([
                    expect.objectContaining({
                        nodeId: 'email-read',
                        expectedInputs: ['mailbox connection', 'message selector'],
                        expectedOutputs: ['email thread text', 'message metadata'],
                        feasible: false,
                    }),
                ]),
                proposedBlocks: expect.arrayContaining([
                    expect.objectContaining({
                        blockId: 'email-read-block',
                        requiredCapabilities: ['email-read'],
                    }),
                    expect.objectContaining({
                        blockId: 'send-reply-block',
                        requiredCapabilities: ['email-reply'],
                    }),
                ]),
            }),
        });
    });

    it('task-graph preflight tools infer a graph, match blocks, and propose missing blocks', async () => {
        const registry = buildDefaultToolRegistry();

        const inferred = await registry.execute(
            {
                toolName: 'inferTaskGraph',
                args: { userRequest: '이메일을 확인해서 답장 해줘' },
            },
            makeToolContext('task-graph-1'),
        );

        expect(inferred).toEqual({
            toolName: 'inferTaskGraph',
            ok: true,
            data: expect.objectContaining({
                taskGraph: expect.objectContaining({
                    nodes: expect.arrayContaining([expect.objectContaining({ id: 'email-read' })]),
                }),
            }),
        });

        const taskGraph = (inferred.data as { taskGraph: Record<string, unknown> }).taskGraph;
        const compatibility = await registry.execute(
            {
                toolName: 'analyzeTaskGraphCompatibility',
                args: { taskGraph },
            },
            makeToolContext('task-graph-1'),
        );

        expect(compatibility).toEqual({
            toolName: 'analyzeTaskGraphCompatibility',
            ok: true,
            data: expect.objectContaining({
                nodeAnalyses: expect.arrayContaining([
                    expect.objectContaining({
                        nodeId: 'email-read',
                        feasible: false,
                    }),
                ]),
            }),
        });

        const nodeAnalyses = (compatibility.data as { nodeAnalyses: unknown[] }).nodeAnalyses;
        const proposed = await registry.execute(
            {
                toolName: 'proposeMissingBlocks',
                args: { nodeAnalyses },
            },
            makeToolContext('task-graph-1'),
        );

        expect(proposed).toEqual({
            toolName: 'proposeMissingBlocks',
            ok: true,
            data: expect.objectContaining({
                proposedBlocks: expect.arrayContaining([
                    expect.objectContaining({ blockId: 'email-read-block' }),
                    expect.objectContaining({ blockId: 'send-reply-block' }),
                ]),
            }),
        });

        const preflight = await registry.execute(
            {
                toolName: 'prevalidateFlowDesignRequest',
                args: { userRequest: '이메일을 확인해서 답장 해줘' },
            },
            makeToolContext('task-graph-1'),
        );

        expect(preflight).toEqual({
            toolName: 'prevalidateFlowDesignRequest',
            ok: true,
            data: expect.objectContaining({
                feasible: false,
                taskGraph: expect.any(Object),
                nodeAnalyses: expect.any(Array),
                proposedBlocks: expect.any(Array),
            }),
        });
    });

    it('prevalidateFlowDesignRequest is shared with flow-designer so design runs can reuse preflight facts', () => {
        const registry = buildDefaultToolRegistry();
        const preflightTool = registry.get('prevalidateFlowDesignRequest');

        expect(preflightTool?.allowedSkills).toEqual(['flow-preflight-validator', 'flow-designer']);
    });

    it('mock tools return deterministic customer and order data', async () => {
        const registry = buildDefaultToolRegistry();

        const customer = await registry.execute(
            { toolName: 'getCustomerById', args: { customerId: 'c_1' } },
            makeToolContext('run-tools-1'),
        );
        const orders = await registry.execute(
            { toolName: 'getOrdersByCustomer', args: { customerId: 'c_1' } },
            makeToolContext('run-tools-1'),
        );
        const policy = await registry.execute(
            { toolName: 'getRefundPolicy', args: {} },
            makeToolContext('run-tools-1'),
        );

        expect(customer).toEqual({
            toolName: 'getCustomerById',
            ok: true,
            data: { id: 'c_1', name: 'Kim Mina', tier: 'gold' },
        });
        expect(orders.ok).toBe(true);
        expect(orders.data).toEqual([
            { orderId: 'o_100', status: 'delivered', total: 129.99 },
            { orderId: 'o_101', status: 'refunded', total: 22.5 },
        ]);
        expect(policy).toEqual({
            toolName: 'getRefundPolicy',
            ok: true,
            data: {
                version: '2026.01',
                text: 'Refund available within 30 days for eligible orders.',
            },
        });
    });

    it('mock read-only tools return safe fallback data for unknown records', async () => {
        const registry = buildDefaultToolRegistry();

        const customer = await registry.execute(
            { toolName: 'getCustomerById', args: { customerId: 'missing' } },
            makeToolContext('run-tools-unknown'),
        );
        const orders = await registry.execute(
            { toolName: 'getOrdersByCustomer', args: { customerId: 'missing' } },
            makeToolContext('run-tools-unknown'),
        );

        expect(customer).toEqual({
            toolName: 'getCustomerById',
            ok: true,
            data: null,
        });
        expect(orders).toEqual({
            toolName: 'getOrdersByCustomer',
            ok: true,
            data: [],
        });
    });

    it('mock side-effect tools still return deterministic payloads', async () => {
        const registry = buildDefaultToolRegistry();

        const ticket = await registry.execute(
            {
                toolName: 'createTicket',
                args: { customerId: 'c_1', reason: 'Escalation requested by agent' },
            },
            makeToolContext('run-tools-2'),
        );
        const refund = await registry.execute(
            { toolName: 'refundOrder', args: { orderId: 'o_100', amount: 25 } },
            makeToolContext('run-tools-2'),
        );
        const slack = await registry.execute(
            {
                toolName: 'sendSlackMessage',
                args: { channel: '#ops', message: 'Daily automation summary ready.' },
            },
            makeToolContext('run-tools-2'),
        );

        expect(ticket).toEqual({
            toolName: 'createTicket',
            ok: true,
            data: {
                ticketId: 't_500',
                customerId: 'c_1',
                reason: 'Escalation requested by agent',
                status: 'created',
            },
        });
        expect(refund).toEqual({
            toolName: 'refundOrder',
            ok: true,
            data: { orderId: 'o_100', amount: 25, status: 'refunded' },
        });
        expect(slack).toEqual({
            toolName: 'sendSlackMessage',
            ok: true,
            data: {
                channel: '#ops',
                message: 'Daily automation summary ready.',
                delivered: true,
            },
        });
    });

    it('flow design tools produce deterministic intent, flow draft, validation, execution, and reflection outputs', async () => {
        const registry = buildDefaultToolRegistry();

        const intent = await registry.execute(
            {
                toolName: 'analyzeFlowRequest',
                args: { userRequest: '키워드를 줄테니 블로그 타이틀 여러개 만들기' },
            },
            makeToolContext('flow-tools-1'),
        );
        const blocks = await registry.execute(
            {
                toolName: 'listAvailableFlowBlocks',
                args: {},
            },
            makeToolContext('flow-tools-1'),
        );
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
            makeToolContext('flow-tools-1'),
        );

        expect(intent.ok).toBe(true);
        expect(intent.data).toEqual(
            expect.objectContaining({
                taskType: 'blog-title-generation',
                wantsMultiple: true,
                desiredCount: 5,
            }),
        );
        expect(blocks.ok).toBe(true);
        expect(blocks.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'ai-generate' })]));
        const probe = await registry.execute(
            {
                toolName: 'probeFlowBlock',
                args: {
                    blockId: 'ai-generate',
                    sampleConfig: {
                        model: 'mock-flow-model',
                        jsonOutput: 'true',
                    },
                    sampleInputs: {
                        system: 'You are helpful.',
                        prompt: 'Return JSON only.',
                    },
                },
            },
            makeToolContext('flow-tools-1'),
        );
        expect(probe).toEqual({
            toolName: 'probeFlowBlock',
            ok: true,
            data: expect.objectContaining({
                blockId: 'ai-generate',
                observedOutputs: {
                    output: expect.objectContaining({
                        model: 'mock-flow-model',
                        format: 'json',
                    }),
                },
                behaviorNotes: expect.any(Array),
                mismatchesFromSpec: expect.any(Array),
            }),
        });
        expect(design.ok).toBe(true);
        expect(design.data).toEqual(
            expect.objectContaining({
                flow: expect.objectContaining({
                    nodes: expect.arrayContaining([expect.objectContaining({ id: 'ai-node', blockId: 'ai-generate' })]),
                }),
            }),
        );

        const flow = (design.data as { flow: Record<string, unknown> }).flow;
        const validation = await registry.execute(
            {
                toolName: 'validateFlowDraft',
                args: { flow },
            },
            makeToolContext('flow-tools-1'),
        );
        const sample = await registry.execute(
            {
                toolName: 'runFlowSample',
                args: {
                    userRequest: '키워드를 줄테니 블로그 타이틀 여러개 만들기',
                    flow,
                },
            },
            makeToolContext('flow-tools-1'),
        );
        const reflection = await registry.execute(
            {
                toolName: 'reflectFlowResult',
                args: {
                    userRequest: '키워드를 줄테니 블로그 타이틀 여러개 만들기',
                    desiredCount: 5,
                    wantsJson: false,
                    sampleResult: {
                        status: 'completed',
                        output: (sample.data as { output?: unknown }).output,
                        logs: (sample.data as { logs: string[] }).logs,
                    },
                },
            },
            makeToolContext('flow-tools-1'),
        );

        expect(validation).toEqual({
            toolName: 'validateFlowDraft',
            ok: true,
            data: expect.objectContaining({
                isValid: true,
                issues: [],
            }),
        });
        expect(sample.ok).toBe(true);
        expect(sample.data).toEqual(
            expect.objectContaining({
                status: 'completed',
                output: expect.stringContaining('블로그 타이틀'),
            }),
        );
        expect(reflection).toEqual({
            toolName: 'reflectFlowResult',
            ok: true,
            data: expect.objectContaining({
                satisfied: true,
                issues: [],
            }),
        });

        const specUpdate = await registry.execute(
            {
                toolName: 'proposeBlockSpecUpdate',
                args: {
                    blockId: 'ai-generate',
                    probeResult: {
                        behaviorNotes: ['Reads system/prompt text and writes the mock generation result into the output port.'],
                        mismatchesFromSpec: ['The output port can emit structured object payloads when jsonOutput=true, but the description does not explain that.'],
                        observedOutputs: {
                            output: {
                                model: 'mock-flow-model',
                                format: 'json',
                            },
                        },
                        observedLogs: [],
                    },
                },
            },
            makeToolContext('flow-tools-1'),
        );

        expect(specUpdate).toEqual({
            toolName: 'proposeBlockSpecUpdate',
            ok: true,
            data: expect.objectContaining({
                blockId: 'ai-generate',
                missingDetails: [
                    'The output port can emit structured object payloads when jsonOutput=true, but the description does not explain that.',
                ],
                suggestedDocPatch: expect.stringContaining('Update ai-generate block documentation to clarify:'),
            }),
        });
    });

    it('registerMany and listBySkills preserve registered tools by skill', () => {
        const registry = new ToolRegistry();
        registry.registerMany([
            makeTestTool(),
            makeTestTool({
                name: 'opsTool',
                allowedSkills: ['ops-automation-agent'],
                parameters: z.object({ value: z.string() }),
            }),
        ]);

        expect(registry.list().map(tool => tool.name)).toEqual(['echoTool', 'opsTool']);
        expect(registry.listBySkills('customer-support-reviewer').map(tool => tool.name)).toEqual(['echoTool']);
        expect(registry.listBySkills('ops-automation-agent').map(tool => tool.name)).toEqual(['opsTool']);
    });

    it('parseArgs validates arguments and throws on invalid input', () => {
        const registry = new ToolRegistry();
        registry.register(makeTestTool());

        expect(registry.parseArgs('echoTool', { value: 'ok' })).toEqual({ value: 'ok' });
        expect(() => registry.parseArgs('echoTool', { value: 123 })).toThrow(/Invalid args for echoTool/);
        expect(() => registry.parseArgs('missingTool', {})).toThrow(/Tool not found: missingTool/);
    });

    it('execute returns tool data and passes runtime context to implementations', async () => {
        const registry = new ToolRegistry();
        registry.register(makeTestTool());

        const result = await registry.execute(
            { toolName: 'echoTool', args: { value: 'hello' } },
            makeToolContext('r-1'),
        );

        expect(result.toolName).toBe('echoTool');
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(
            expect.objectContaining({
                value: 'hello',
                runId: 'r-1',
                now: expect.any(Number),
            }),
        );
    });

    it('execute returns structured errors for missing tools, bad args, and thrown failures', async () => {
        const registry = new ToolRegistry();
        registry.register(
            makeTestTool({
                name: 'brokenTool',
                execute: async () => {
                    throw new Error('boom');
                },
            }),
        );

        await expect(registry.execute({ toolName: 'missingTool', args: {} }, makeToolContext('r-2'))).resolves.toEqual({
            toolName: 'missingTool',
            ok: false,
            error: 'Tool not found',
        });

        await expect(
            registry.execute({ toolName: 'brokenTool', args: { value: 123 } }, makeToolContext('r-2')),
        ).resolves.toEqual({
            toolName: 'brokenTool',
            ok: false,
            error: expect.stringMatching(/Invalid args for brokenTool/),
        });

        await expect(
            registry.execute({ toolName: 'brokenTool', args: { value: 'ok' } }, makeToolContext('r-2')),
        ).resolves.toEqual({
            toolName: 'brokenTool',
            ok: false,
            error: 'boom',
        });
    });

    it('AnyArgsSchema accepts arbitrary records for generic tool wiring', () => {
        expect(AnyArgsSchema.parse({ a: 1, b: 'two', nested: { ok: true } })).toEqual({
            a: 1,
            b: 'two',
            nested: { ok: true },
        });
    });

    it('AnyArgsSchema rejects non-object inputs', () => {
        expect(() => AnyArgsSchema.parse('nope')).toThrow();
    });
});
