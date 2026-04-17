// Tool metadata and deterministic mock-tool bundles.
import { z } from 'zod';
import { buildToolPackFromResource, loadToolPackResource, type ToolDefinitionSeed } from '../tools/core/resources';
import { type ToolContext, type ToolDefinition, type ToolPack, type ToolRepositoryBundle } from '../tools/core/types';

const customers: Record<string, { id: string; name: string; tier: string }> = {
    c_1: { id: 'c_1', name: 'Kim Mina', tier: 'gold' },
    c_2: { id: 'c_2', name: 'Park Joon', tier: 'basic' },
};

const orders: Record<string, { orderId: string; status: string; total: number }[]> = {
    c_1: [
        { orderId: 'o_100', status: 'delivered', total: 129.99 },
        { orderId: 'o_101', status: 'refunded', total: 22.5 },
    ],
    c_2: [{ orderId: 'o_200', status: 'delayed', total: 59.0 }],
};

function defineMockToolExecutor<TArgs extends Record<string, unknown>>(
    handler: (args: TArgs, context: ToolContext) => Promise<unknown> | unknown,
) {
    return async (args: Record<string, unknown>, context: ToolContext) => {
        return await handler(args as TArgs, context);
    };
}

const MOCK_EXECUTE_IDS = {
    getCustomerById: 'mock.get-customer-by-id',
    getOrdersByCustomer: 'mock.get-orders-by-customer',
    getRefundPolicy: 'mock.get-refund-policy',
    webSearch: 'mock.web-search',
    createTicket: 'mock.create-ticket',
    sendSlackMessage: 'mock.send-slack-message',
    refundOrder: 'mock.refund-order',
} as const;

function getMockToolDefinitions(): Record<string, ToolDefinitionSeed> {
    return {
        getCustomerById: {
            name: 'getCustomerById',
            parameters: z.object({ customerId: z.string() }),
        },
        getOrdersByCustomer: {
            name: 'getOrdersByCustomer',
            parameters: z.object({ customerId: z.string() }),
        },
        getRefundPolicy: {
            name: 'getRefundPolicy',
            parameters: z.object({}),
        },
        webSearch: {
            name: 'webSearch',
            parameters: z.object({ query: z.string() }),
        },
        createTicket: {
            name: 'createTicket',
            parameters: z.object({ customerId: z.string(), reason: z.string() }),
        },
        sendSlackMessage: {
            name: 'sendSlackMessage',
            parameters: z.object({ channel: z.string(), message: z.string() }),
        },
        refundOrder: {
            name: 'refundOrder',
            parameters: z.object({ orderId: z.string(), amount: z.number() }),
        },
    };
}

function getMockToolExecutors() {
    return {
        [MOCK_EXECUTE_IDS.getCustomerById]: defineMockToolExecutor<{ customerId: string }>(
            async ({ customerId }) => customers[customerId] ?? null,
        ),
        [MOCK_EXECUTE_IDS.getOrdersByCustomer]: defineMockToolExecutor<{ customerId: string }>(
            async ({ customerId }) => orders[customerId] ?? [],
        ),
        [MOCK_EXECUTE_IDS.getRefundPolicy]: defineMockToolExecutor<Record<string, never>>(async () => ({
            version: '2026.01',
            text: 'Refund available within 30 days for eligible orders.',
        })),
        [MOCK_EXECUTE_IDS.webSearch]: defineMockToolExecutor<{ query: string }>(async ({ query }) => ({
            query,
            results: [
                { title: 'Result A', snippet: 'Mock result A.' },
                { title: 'Result B', snippet: 'Mock result B.' },
            ],
        })),
        [MOCK_EXECUTE_IDS.createTicket]: defineMockToolExecutor<{ customerId: string; reason: string }>(
            async ({ customerId, reason }) => ({
                ticketId: 't_500',
                customerId,
                reason,
                status: 'created',
            }),
        ),
        [MOCK_EXECUTE_IDS.sendSlackMessage]: defineMockToolExecutor<{ channel: string; message: string }>(
            async ({ channel, message }) => ({
                channel,
                message,
                delivered: true,
            }),
        ),
        [MOCK_EXECUTE_IDS.refundOrder]: defineMockToolExecutor<{ orderId: string; amount: number }>(
            async ({ orderId, amount }) => ({
                orderId,
                amount,
                status: 'refunded',
            }),
        ),
    };
}

/** Returns deterministic mock-tool metadata plus executor mappings for demos, tests, and local development. */
export async function createMockToolBundle(): Promise<ToolRepositoryBundle> {
    return (await createMockToolPack()).bundle;
}

/** Groups deterministic mock tools into a named pack for repository-level registration. */
export async function createMockToolPack(): Promise<ToolPack> {
    const resource = await loadToolPackResource('tools.sample-tools.set');
    const pack = buildToolPackFromResource(resource, getMockToolDefinitions());
    return {
        ...pack,
        bundle: {
            tools: pack.bundle.tools,
            executors: getMockToolExecutors(),
        },
    };
}

/** Returns deterministic mock tool metadata for callers that only need the visible tool pool. */
export async function createMockTools(): Promise<ToolDefinition[]> {
    return (await createMockToolBundle()).tools;
}
