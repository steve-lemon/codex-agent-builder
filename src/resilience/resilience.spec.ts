// Vitest specs for core runtime behaviors.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AgentRuntime } from '../agent/runtime';
import { InMemoryRunStateStore } from '../state/memory-store';
import { ToolRegistry } from '../tools/registry';
import type { LlmGateway } from '../llm/types';

describe('resilience behaviors', () => {
    it('retry succeeds for transient read-only failure', async () => {
        const registry = new ToolRegistry();
        let attempts = 0;

        registry.registerMany([
            {
                name: 'getCustomerById',
                description: 'flaky read',
                parameters: z.object({ customerId: z.string() }),
                riskLevel: 'read-only',
                allowedSkills: ['customer-support-reviewer'],
                requiresConfirmation: false,
                parallelSafe: true,
                execute: async () => {
                    attempts += 1;
                    if (attempts < 2) {
                        const err = new Error('temporary network issue');
                        (err as { transient?: boolean }).transient = true;
                        throw err;
                    }
                    return { id: 'c_1' };
                },
            },
        ]);

        const llm: LlmGateway = {
            plan: async () => ({
                steps: [
                    {
                        id: 's1',
                        mode: 'single-tool',
                        description: 'read once',
                        toolCalls: [{ toolName: 'getCustomerById', args: { customerId: 'c_1' } }],
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

        const result = await runtime.run('customer check');
        expect(result.status).toBe('completed');
        expect(attempts).toBe(2);
    });

    it('circuit breaker opens after repeated failures', async () => {
        const registry = new ToolRegistry();
        let attempts = 0;

        registry.registerMany([
            {
                name: 'getCustomerById',
                description: 'always failing read',
                parameters: z.object({ customerId: z.string() }),
                riskLevel: 'read-only',
                allowedSkills: ['customer-support-reviewer'],
                requiresConfirmation: false,
                parallelSafe: true,
                execute: async () => {
                    attempts += 1;
                    const err = new Error('temporary network issue');
                    (err as { transient?: boolean }).transient = true;
                    throw err;
                },
            },
        ]);

        const llm: LlmGateway = {
            plan: async () => ({
                steps: [
                    {
                        id: 's1',
                        mode: 'single-tool',
                        description: 'first failure path',
                        toolCalls: [{ toolName: 'getCustomerById', args: { customerId: 'c_1' } }],
                    },
                    {
                        id: 's2',
                        mode: 'single-tool',
                        description: 'second call should see open circuit',
                        toolCalls: [{ toolName: 'getCustomerById', args: { customerId: 'c_1' } }],
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

        const result = await runtime.run('customer check');
        expect(result.status).toBe('failed');

        const errorEvents = result.trace.filter(e => e.type === 'error');
        expect(errorEvents.length).toBeGreaterThan(0);
        expect(attempts).toBeGreaterThanOrEqual(2);
    });

    it('does not retry non-retryable read-only failures', async () => {
        const registry = new ToolRegistry();
        let attempts = 0;

        registry.registerMany([
            {
                name: 'getCustomerById',
                description: 'hard validation failure',
                parameters: z.object({ customerId: z.string() }),
                riskLevel: 'read-only',
                allowedSkills: ['customer-support-reviewer'],
                requiresConfirmation: false,
                parallelSafe: true,
                execute: async () => {
                    attempts += 1;
                    throw new Error('permanent validation failure');
                },
            },
        ]);

        const llm: LlmGateway = {
            plan: async () => ({
                steps: [
                    {
                        id: 's1',
                        mode: 'single-tool',
                        description: 'read once',
                        toolCalls: [{ toolName: 'getCustomerById', args: { customerId: 'c_1' } }],
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

        const result = await runtime.run('customer check');
        expect(result.status).toBe('failed');
        expect(attempts).toBe(1);
    });
});
