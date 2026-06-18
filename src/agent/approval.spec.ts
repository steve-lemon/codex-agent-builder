// Vitest specs for core runtime behaviors.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AgentRuntime } from './runtime';
import { FakeLlmGateway } from '../llm/fake-gateway';
import { InMemoryRunStateStore } from '../state/memory-store';
import { buildDefaultToolRegistry } from '../tools';
import { ToolRegistry } from '../tools';
import type { LlmGateway } from '../llm/types';
import { defineTool } from '../tools';

describe('approval flow', () => {
    it('suspends run when tool requires approval', async () => {
        const runtime = new AgentRuntime({
            llm: new FakeLlmGateway(),
            store: new InMemoryRunStateStore(),
            toolRegistry: await buildDefaultToolRegistry(),
        });

        const result = await runtime.run('Please refund this customer order now.');
        expect(result.status).toBe('waiting_for_approval');
        expect(result.waitingApproval?.toolCall.toolName).toBe('refundOrder');
    });

    it('approved run resumes and completes', async () => {
        const runtime = new AgentRuntime({
            llm: new FakeLlmGateway(),
            store: new InMemoryRunStateStore(),
            toolRegistry: await buildDefaultToolRegistry(),
        });

        const waiting = await runtime.run('Please refund this customer order now.');
        expect(waiting.status).toBe('waiting_for_approval');

        const resumed = await runtime.resume(waiting.runId, { decision: 'approve' });
        expect(resumed.status).toBe('completed');
    });

    it('rejected approval leaves tool unexecuted and still completes', async () => {
        const runtime = new AgentRuntime({
            llm: new FakeLlmGateway(),
            store: new InMemoryRunStateStore(),
            toolRegistry: await buildDefaultToolRegistry(),
        });

        const waiting = await runtime.run('Please refund this customer order now.');
        const resumed = await runtime.resume(waiting.runId, { decision: 'reject' });

        expect(resumed.status).toBe('completed');
        const events = resumed.trace.filter(e => e.type === 'tool_end' && e.data?.toolName === 'refundOrder');
        expect(events.length).toBe(0);
    });

    it('edit-and-approve resumes with operator-edited arguments', async () => {
        const store = new InMemoryRunStateStore();
        const registry = new ToolRegistry();
        const executedAmounts: number[] = [];

        registry.registerMany([
            defineTool({
                name: 'getCustomerById',
                description: 'customer lookup',
                parameters: z.object({ customerId: z.string() }),
                riskLevel: 'read-only',
                allowedSkills: ['customer-support-reviewer'],
                requiresConfirmation: false,
                parallelSafe: true,
                execute: async () => ({ id: 'c_1' }),
            }),
            defineTool({
                name: 'getOrdersByCustomer',
                description: 'order lookup',
                parameters: z.object({ customerId: z.string() }),
                riskLevel: 'read-only',
                allowedSkills: ['customer-support-reviewer'],
                requiresConfirmation: false,
                parallelSafe: true,
                execute: async () => [{ orderId: 'o_100' }],
            }),
            defineTool({
                name: 'getRefundPolicy',
                description: 'policy lookup',
                parameters: z.object({}),
                riskLevel: 'read-only',
                allowedSkills: ['customer-support-reviewer'],
                requiresConfirmation: false,
                parallelSafe: true,
                execute: async () => ({ version: '2026.01' }),
            }),
            defineTool({
                name: 'refundOrder',
                description: 'refund',
                parameters: z.object({ orderId: z.string(), amount: z.number() }),
                riskLevel: 'approval-required',
                allowedSkills: ['customer-support-reviewer'],
                requiresConfirmation: true,
                parallelSafe: false,
                execute: async ({ amount }) => {
                    executedAmounts.push(amount);
                    return { status: 'refunded', amount };
                },
            }),
        ]);

        const llm: LlmGateway = {
            plan: async () => ({
                steps: [
                    {
                        id: 's1',
                        mode: 'parallel-tools',
                        description: 'load context',
                        toolCalls: [
                            { toolName: 'getCustomerById', args: { customerId: 'c_1' } },
                            { toolName: 'getOrdersByCustomer', args: { customerId: 'c_1' } },
                            { toolName: 'getRefundPolicy', args: {} },
                        ],
                    },
                    {
                        id: 's2',
                        mode: 'single-tool',
                        description: 'refund',
                        toolCalls: [{ toolName: 'refundOrder', args: { orderId: 'o_100', amount: 25 } }],
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

        const runtime = new AgentRuntime({ llm, store, toolRegistry: registry });
        const waiting = await runtime.run('Please refund this customer order now.');
        const resumed = await runtime.resume(waiting.runId, {
            decision: 'edit-and-approve',
            editedArgs: { orderId: 'o_100', amount: 10 },
        });

        expect(resumed.status).toBe('completed');
        expect(executedAmounts).toEqual([10]);
    });

    it('resume throws for unknown run ids', async () => {
        const runtime = new AgentRuntime({
            llm: new FakeLlmGateway(),
            store: new InMemoryRunStateStore(),
            toolRegistry: await buildDefaultToolRegistry(),
        });

        await expect(runtime.resume('missing-run', { decision: 'approve' })).rejects.toThrow(
            /Run not found: missing-run/,
        );
    });

    it('resume throws when the run is not waiting for approval', async () => {
        const runtime = new AgentRuntime({
            llm: new FakeLlmGateway(),
            store: new InMemoryRunStateStore(),
            toolRegistry: await buildDefaultToolRegistry(),
        });

        const completed = await runtime.run('Review customer issue and summarize.');

        await expect(runtime.resume(completed.runId, { decision: 'approve' })).rejects.toThrow(
            new RegExp(`Run ${completed.runId} is not waiting for approval`),
        );
    });
});
