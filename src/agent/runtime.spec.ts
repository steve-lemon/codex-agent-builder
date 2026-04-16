// Vitest specs for core runtime behaviors.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AgentRuntime } from './runtime';
import { FakeLlmGateway } from '../llm/fake-gateway';
import { InMemoryRunStateStore } from '../state/memory-store';
import { ToolRegistry } from '../tools/registry';
import { buildDefaultToolRegistry } from '../tools';
import type { LlmGateway } from '../llm/types';
import { now } from '../time/now';

function buildDefaultRuntime() {
    return new AgentRuntime({
        llm: new FakeLlmGateway(),
        store: new InMemoryRunStateStore(),
        toolRegistry: buildDefaultToolRegistry(),
    });
}

describe('runtime flow', () => {
    it('completes planner/executor/reflector/finalizer flow with fake gateway', async () => {
        const runtime = buildDefaultRuntime();
        const result = await runtime.run('Review customer issue and summarize');

        expect(result.status).toBe('completed');
        expect(result.finalResult).toBeDefined();
        expect(result.finalResult?.summary).toContain('customer-support-reviewer');
        expect(Array.isArray(result.finalResult?.nextActions)).toBe(true);
    });

    it('completes a flow-designer skill run with the bundled flow-design tools', async () => {
        const runtime = buildDefaultRuntime();
        const result = await runtime.run('키워드를 줄테니 블로그 타이틀 여러개 만들기');

        expect(result.status).toBe('completed');
        expect(result.finalResult?.summary).toContain('flow-designer');
    });

    it('stops early and reports missing capabilities when the request cannot be satisfied by available blocks', async () => {
        const runtime = buildDefaultRuntime();
        const result = await runtime.run('이메일을 확인해서 답장 해줘');

        expect(result.status).toBe('completed');
        expect(result.finalResult).toEqual(
            expect.objectContaining({
                success: false,
                summary: expect.stringContaining('missing: email-read, email-reply'),
                nextActions: expect.arrayContaining([expect.stringContaining('email-read')]),
            }),
        );
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
        const runtime = buildDefaultRuntime();
        const result = await runtime.run('Prepare a quick customer summary');
        expect(result.finalResult).toEqual(
            expect.objectContaining({
                summary: expect.any(String),
                success: expect.any(Boolean),
                nextActions: expect.any(Array),
            }),
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
        };

        const runtime = new AgentRuntime({
            llm,
            store: new InMemoryRunStateStore(),
            toolRegistry: buildDefaultToolRegistry(),
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
        };

        const runtime = new AgentRuntime({
            llm,
            store: new InMemoryRunStateStore(),
            toolRegistry: buildDefaultToolRegistry(),
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
        };

        const runtime = new AgentRuntime({
            llm,
            store: new InMemoryRunStateStore(),
            toolRegistry: buildDefaultToolRegistry(),
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
        };

        const runtime = new AgentRuntime({
            llm,
            store: new InMemoryRunStateStore(),
            toolRegistry: buildDefaultToolRegistry(),
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
