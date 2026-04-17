// Vitest specs for core runtime behaviors.
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AgentRuntime } from '../agent/runtime';
import { AgentError } from '../errors/agent-error';
import { InMemoryRunStateStore } from '../state/memory-store';
import { ToolRegistry } from '../tools/registry';
import type { LlmGateway } from '../llm/types';
import { computeBackoffMs, sleep } from './backoff';
import { CircuitBreaker } from './circuit-breaker';
import { resilientExecute } from './resilient-execute';
import { isRetryableError } from './retry-classifier';
import { withTimeout } from './timeout';

describe('resilience behaviors', () => {
    it('computes exponential backoff from the first retry attempt onward', () => {
        expect(computeBackoffMs(1, 50)).toBe(50);
        expect(computeBackoffMs(2, 50)).toBe(100);
        expect(computeBackoffMs(3, 50)).toBe(200);
        expect(computeBackoffMs(0, 50)).toBe(50);
    });

    it('sleep waits asynchronously before resolving', async () => {
        const started = Date.now();
        await sleep(10);
        expect(Date.now() - started).toBeGreaterThanOrEqual(8);
    });

    it('withTimeout returns the original result when execution finishes in time', async () => {
        await expect(withTimeout(Promise.resolve('ok'), 25)).resolves.toBe('ok');
    });

    it('withTimeout rejects with a transient AgentError when execution exceeds the limit', async () => {
        const promise = new Promise(resolve => setTimeout(() => resolve('late'), 25));

        await expect(withTimeout(promise, 5)).rejects.toMatchObject({
            name: 'AgentError',
            message: 'Operation timed out after 5ms',
            transient: true,
        });
    });

    it('retry classifier recognizes transient AgentErrors and retryable messages', () => {
        expect(isRetryableError(new AgentError('rate limit exceeded'))).toBe(true);
        expect(isRetryableError(new AgentError('boom', { transient: true }))).toBe(true);
        expect(isRetryableError(new Error('temporary network issue'))).toBe(true);
        expect(isRetryableError(new Error('permanent validation failure'))).toBe(false);
        expect(isRetryableError('not-an-error')).toBe(false);
    });

    it('circuit breaker opens after threshold and closes again after cooldown', () => {
        vi.useFakeTimers();
        try {
            const breaker = new CircuitBreaker({ failureThreshold: 2, coolDownMs: 100 });

            expect(breaker.canExecute('tool-a')).toBe(true);

            breaker.onFailure('tool-a');
            expect(breaker.getState('tool-a')).toBe('closed');
            expect(breaker.canExecute('tool-a')).toBe(true);

            breaker.onFailure('tool-a');
            expect(breaker.getState('tool-a')).toBe('open');
            expect(breaker.canExecute('tool-a')).toBe(false);

            vi.advanceTimersByTime(100);
            expect(breaker.canExecute('tool-a')).toBe(true);
            expect(breaker.getState('tool-a')).toBe('closed');
        } finally {
            vi.useRealTimers();
        }
    });

    it('resilientExecute retries retryable failures and eventually succeeds', async () => {
        let attempts = 0;

        const result = await resilientExecute({
            key: 'retryable-tool',
            timeoutMs: 50,
            retry: { maxAttempts: 3, baseDelayMs: 1 },
            enableCircuitBreaker: false,
            execute: async () => {
                attempts += 1;
                if (attempts < 3) {
                    throw new AgentError('temporary network issue', { transient: true });
                }
                return 'done';
            },
        });

        expect(result).toBe('done');
        expect(attempts).toBe(3);
    });

    it('resilientExecute fails fast when the circuit breaker is already open', async () => {
        const breaker = new CircuitBreaker({ failureThreshold: 1, coolDownMs: 1000 });
        breaker.onFailure('blocked-tool');

        await expect(
            resilientExecute({
                key: 'blocked-tool',
                timeoutMs: 50,
                retry: { maxAttempts: 3, baseDelayMs: 1 },
                circuitBreaker: breaker,
                enableCircuitBreaker: true,
                execute: async () => 'never',
            }),
        ).rejects.toMatchObject({
            name: 'AgentError',
            message: 'Circuit breaker is open for blocked-tool',
        });
    });

    it('resilientExecute wraps non-Error failures as AgentError', async () => {
        await expect(
            resilientExecute({
                key: 'non-error',
                timeoutMs: 50,
                retry: { maxAttempts: 1, baseDelayMs: 1 },
                enableCircuitBreaker: false,
                execute: async () => {
                    throw 42;
                },
            }),
        ).rejects.toMatchObject({
            name: 'AgentError',
            message: 'Agent execution failed',
            cause: 42,
        });
    });

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
            generateStructured: async () => {
                throw new Error('unused generateStructured mock');
            },
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
            generateStructured: async () => {
                throw new Error('unused generateStructured mock');
            },
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
            generateStructured: async () => {
                throw new Error('unused generateStructured mock');
            },
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
