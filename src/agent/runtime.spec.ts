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
    toolRegistry: buildDefaultToolRegistry()
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
          await new Promise((r) => setTimeout(r, 120));
          timeline.push({ name: 'getCustomerById:end', ts: now() });
          return { ok: true };
        }
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
          await new Promise((r) => setTimeout(r, 120));
          timeline.push({ name: 'getOrdersByCustomer:end', ts: now() });
          return { ok: true };
        }
      },
      {
        name: 'getRefundPolicy',
        description: 'C',
        parameters: z.object({}),
        riskLevel: 'read-only',
        allowedSkills: ['customer-support-reviewer'],
        requiresConfirmation: false,
        parallelSafe: true,
        execute: async () => ({ ok: true })
      }
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
              { toolName: 'getOrdersByCustomer', args: { customerId: 'c_1' } }
            ]
          },
          { id: 'f', mode: 'finalize', description: 'done' }
        ]
      }),
      reflect: async () => ({ isComplete: true, reason: 'ok', missingItems: [] }),
      finalize: async () => ({ summary: 'done', success: true, nextActions: [] })
    };

    const runtime = new AgentRuntime({
      llm,
      store: new InMemoryRunStateStore(),
      toolRegistry: registry
    });

    const started = now();
    const result = await runtime.run('customer question');
    const duration = now() - started;

    expect(result.status).toBe('completed');
    expect(duration).toBeLessThan(230);

    const aStart = timeline.find((x) => x.name === 'getCustomerById:start')!.ts;
    const bStart = timeline.find((x) => x.name === 'getOrdersByCustomer:start')!.ts;
    expect(Math.abs(aStart - bStart)).toBeLessThan(40);
  });

  it('final result contains expected structured fields', async () => {
    const runtime = buildDefaultRuntime();
    const result = await runtime.run('Prepare a quick customer summary');
    expect(result.finalResult).toEqual(
      expect.objectContaining({
        summary: expect.any(String),
        success: expect.any(Boolean),
        nextActions: expect.any(Array)
      })
    );
  });

  it('fails the run when a single-tool step has no tool calls', async () => {
    const llm: LlmGateway = {
      plan: async () => ({
        steps: [
          { id: 'bad-step', mode: 'single-tool', description: 'missing tool call' },
          { id: 'f', mode: 'finalize', description: 'done' }
        ]
      }),
      reflect: async () => ({ isComplete: true, reason: 'ok', missingItems: [] }),
      finalize: async () => ({ summary: 'done', success: true, nextActions: [] })
    };

    const runtime = new AgentRuntime({
      llm,
      store: new InMemoryRunStateStore(),
      toolRegistry: buildDefaultToolRegistry()
    });

    const result = await runtime.run('customer question');

    expect(result.status).toBe('failed');
    expect(result.trace.some((event) => event.type === 'error')).toBe(true);
  });

  it('fails the run when planner returns a tool not allowed for the selected skill', async () => {
    const llm: LlmGateway = {
      plan: async () => ({
        steps: [
          {
            id: 'bad-step',
            mode: 'single-tool',
            description: 'attempt disallowed tool',
            toolCalls: [{ toolName: 'webSearch', args: { query: 'leak' } }]
          },
          { id: 'f', mode: 'finalize', description: 'done' }
        ]
      }),
      reflect: async () => ({ isComplete: true, reason: 'ok', missingItems: [] }),
      finalize: async () => ({ summary: 'done', success: true, nextActions: [] })
    };

    const runtime = new AgentRuntime({
      llm,
      store: new InMemoryRunStateStore(),
      toolRegistry: buildDefaultToolRegistry()
    });

    const result = await runtime.run('Please review this customer complaint.');

    expect(result.status).toBe('failed');
    expect(
      result.trace.some(
        (event) =>
          event.type === 'error' &&
          String(event.data?.message).includes(
            'Tool webSearch is not allowed for skill customer-support-reviewer'
          )
      )
    ).toBe(true);
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
                args: { customerId: 'c_1', reason: 'should not run in parallel' }
              }
            ]
          },
          { id: 'f', mode: 'finalize', description: 'done' }
        ]
      }),
      reflect: async () => ({ isComplete: true, reason: 'ok', missingItems: [] }),
      finalize: async () => ({ summary: 'done', success: true, nextActions: [] })
    };

    const runtime = new AgentRuntime({
      llm,
      store: new InMemoryRunStateStore(),
      toolRegistry: buildDefaultToolRegistry()
    });

    const result = await runtime.run('Please review this customer complaint.');

    expect(result.status).toBe('failed');
    expect(
      result.trace.some(
        (event) =>
          event.type === 'error' &&
          String(event.data?.message).includes(
            'parallel-tools step includes non parallel-safe/read-only tools: createTicket'
          )
      )
    ).toBe(true);
  });
});
