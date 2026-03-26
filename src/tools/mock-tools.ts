// Tool metadata, registration, and mock implementations.
import { z } from 'zod';
import type { ToolDefinition } from './types';

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

/** Returns deterministic mock tools used for demos, tests, and local development. */
export function createMockTools(): ToolDefinition[] {
    return [
        {
            name: 'getCustomerById',
            description: 'Fetch customer profile by id',
            parameters: z.object({ customerId: z.string() }),
            riskLevel: 'read-only',
            allowedSkills: ['customer-support-reviewer'],
            requiresConfirmation: false,
            parallelSafe: true,
            execute: async ({ customerId }) => customers[customerId] ?? null,
        },
        {
            name: 'getOrdersByCustomer',
            description: 'List orders for customer',
            parameters: z.object({ customerId: z.string() }),
            riskLevel: 'read-only',
            allowedSkills: ['customer-support-reviewer'],
            requiresConfirmation: false,
            parallelSafe: true,
            execute: async ({ customerId }) => orders[customerId] ?? [],
        },
        {
            name: 'getRefundPolicy',
            description: 'Return refund policy text',
            parameters: z.object({}),
            riskLevel: 'read-only',
            allowedSkills: ['customer-support-reviewer', 'ops-automation-agent'],
            requiresConfirmation: false,
            parallelSafe: true,
            execute: async () => ({
                version: '2026.01',
                text: 'Refund available within 30 days for eligible orders.',
            }),
        },
        {
            name: 'webSearch',
            description: 'Deterministic web search mock',
            parameters: z.object({ query: z.string() }),
            riskLevel: 'read-only',
            allowedSkills: ['research-brief-generator', 'ops-automation-agent'],
            requiresConfirmation: false,
            parallelSafe: true,
            execute: async ({ query }) => ({
                query,
                results: [
                    { title: 'Result A', snippet: 'Mock result A.' },
                    { title: 'Result B', snippet: 'Mock result B.' },
                ],
            }),
        },
        {
            name: 'createTicket',
            description: 'Create support ticket in ticketing system',
            parameters: z.object({ customerId: z.string(), reason: z.string() }),
            riskLevel: 'side-effecting',
            allowedSkills: ['customer-support-reviewer', 'ops-automation-agent'],
            requiresConfirmation: true,
            parallelSafe: false,
            execute: async ({ customerId, reason }) => ({
                ticketId: 't_500',
                customerId,
                reason,
                status: 'created',
            }),
        },
        {
            name: 'sendSlackMessage',
            description: 'Send operational Slack message',
            parameters: z.object({ channel: z.string(), message: z.string() }),
            riskLevel: 'side-effecting',
            allowedSkills: ['ops-automation-agent'],
            requiresConfirmation: true,
            parallelSafe: false,
            execute: async ({ channel, message }) => ({
                channel,
                message,
                delivered: true,
            }),
        },
        {
            name: 'refundOrder',
            description: 'Trigger refund for order',
            parameters: z.object({ orderId: z.string(), amount: z.number() }),
            riskLevel: 'approval-required',
            allowedSkills: ['customer-support-reviewer'],
            requiresConfirmation: true,
            parallelSafe: false,
            execute: async ({ orderId, amount }) => ({
                orderId,
                amount,
                status: 'refunded',
            }),
        },
    ];
}
