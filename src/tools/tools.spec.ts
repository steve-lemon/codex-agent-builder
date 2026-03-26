// Vitest specs for core runtime behaviors.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildDefaultToolRegistry } from '.';
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
