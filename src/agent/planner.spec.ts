// Vitest specs for planner grounding and validation behavior.
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Planner } from './planner';
import type { LlmGateway } from '../llm/types';
import { defineTool, buildToolManifest } from '../tools';

describe('Planner', () => {
    const customerTool = defineTool({
        name: 'getCustomerById',
        description: 'Fetch a customer by id',
        parameters: z.object({ customerId: z.string() }),
        riskLevel: 'read-only',
        allowedSkills: ['customer-support-reviewer'],
        requiresConfirmation: false,
        parallelSafe: true,
        execute: async () => ({ id: 'c_1' }),
    });

    const refundTool = defineTool({
        name: 'refundOrder',
        description: 'Refund a customer order',
        parameters: z.object({ orderId: z.string(), amount: z.number() }),
        riskLevel: 'approval-required',
        allowedSkills: ['customer-support-reviewer'],
        requiresConfirmation: true,
        parallelSafe: false,
        execute: async () => ({ ok: true }),
    });

    it('passes grounded tool manifests to the gateway and returns a validated plan', async () => {
        const planMock: LlmGateway['plan'] = async input => {
            expect(input.allowedTools).toEqual(['getCustomerById', 'refundOrder']);
            expect(input.toolManifests).toEqual([
                expect.objectContaining({
                    name: 'getCustomerById',
                    description: 'Fetch a customer by id',
                    parametersJsonSchema: expect.objectContaining({
                        type: 'object',
                    }),
                }),
                expect.objectContaining({
                    name: 'refundOrder',
                    requiresConfirmation: true,
                }),
            ]);

            return {
                steps: [
                    {
                        id: 's1',
                        mode: 'single-tool',
                        description: 'Load customer',
                        toolCalls: [{ toolName: 'getCustomerById', args: { customerId: 'c_1' } }],
                    },
                    { id: 's2', mode: 'finalize', description: 'done' },
                ],
            };
        };

        const llm: LlmGateway = {
            plan: vi.fn(planMock),
            reflect: async () => ({ isComplete: true, reason: 'ok', missingItems: [] }),
            finalize: async () => ({ summary: 'done', success: true, nextActions: [] }),
            generateStructured: async () => {
                throw new Error('unused generateStructured mock');
            },
        };

        const planner = new Planner(llm);
        const plan = await planner.createPlan({
            userInput: 'Load the customer',
            skillName: 'customer-support-reviewer',
            skillInstructions: 'Use support tools only.',
            allowedTools: ['getCustomerById', 'refundOrder'],
            toolManifests: [buildToolManifest(customerTool), buildToolManifest(refundTool)],
            toolDefinitions: [customerTool, refundTool],
        });

        expect(plan.steps[0]?.toolCalls?.[0]).toEqual({
            toolName: 'getCustomerById',
            args: { customerId: 'c_1' },
        });
    });

    it('rejects plans that reference tools outside the available tool definitions', async () => {
        const llm: LlmGateway = {
            plan: async () => ({
                steps: [
                    {
                        id: 's1',
                        mode: 'single-tool',
                        description: 'Use unavailable tool',
                        toolCalls: [{ toolName: 'webSearch', args: { query: 'leak' } }],
                    },
                ],
            }),
            reflect: async () => ({ isComplete: true, reason: 'ok', missingItems: [] }),
            finalize: async () => ({ summary: 'done', success: true, nextActions: [] }),
            generateStructured: async () => {
                throw new Error('unused generateStructured mock');
            },
        };

        const planner = new Planner(llm);

        await expect(
            planner.createPlan({
                userInput: 'Search the web',
                skillName: 'customer-support-reviewer',
                skillInstructions: 'Use support tools only.',
                allowedTools: ['getCustomerById'],
                toolManifests: [buildToolManifest(customerTool)],
                toolDefinitions: [customerTool],
            }),
        ).rejects.toThrow(/Planner returned tool webSearch that is not available in this run/);
    });

    it('rejects plans whose tool args do not satisfy the selected tool schema', async () => {
        const llm: LlmGateway = {
            plan: async () => ({
                steps: [
                    {
                        id: 's1',
                        mode: 'single-tool',
                        description: 'Refund order',
                        toolCalls: [{ toolName: 'refundOrder', args: { orderId: 'o_100', amount: '25' } }],
                    },
                ],
            }),
            reflect: async () => ({ isComplete: true, reason: 'ok', missingItems: [] }),
            finalize: async () => ({ summary: 'done', success: true, nextActions: [] }),
            generateStructured: async () => {
                throw new Error('unused generateStructured mock');
            },
        };

        const planner = new Planner(llm);

        await expect(
            planner.createPlan({
                userInput: 'Refund the order',
                skillName: 'customer-support-reviewer',
                skillInstructions: 'Use support tools only.',
                allowedTools: ['refundOrder'],
                toolManifests: [buildToolManifest(refundTool)],
                toolDefinitions: [refundTool],
            }),
        ).rejects.toThrow(/Planner returned invalid args for refundOrder/);
    });

    it('accepts plans that use structured step-result references in later tool args', async () => {
        const llm: LlmGateway = {
            plan: async () => ({
                steps: [
                    {
                        id: 's1',
                        mode: 'single-tool',
                        description: 'Load customer',
                        toolCalls: [{ toolName: 'getCustomerById', args: { customerId: 'c_1' } }],
                    },
                    {
                        id: 's2',
                        mode: 'single-tool',
                        description: 'Refund order using prior result references',
                        toolCalls: [
                            {
                                toolName: 'refundOrder',
                                args: {
                                    orderId: 'o_100',
                                    amount: { $fromStep: 's1', path: 'toolResults.0.data.creditAmount' },
                                },
                            },
                        ],
                    },
                ],
            }),
            reflect: async () => ({ isComplete: true, reason: 'ok', missingItems: [] }),
            finalize: async () => ({ summary: 'done', success: true, nextActions: [] }),
            generateStructured: async () => {
                throw new Error('unused generateStructured mock');
            },
        };

        const planner = new Planner(llm);
        const plan = await planner.createPlan({
            userInput: 'Refund using prior data',
            skillName: 'customer-support-reviewer',
            skillInstructions: 'Use support tools only.',
            allowedTools: ['getCustomerById', 'refundOrder'],
            toolManifests: [buildToolManifest(customerTool), buildToolManifest(refundTool)],
            toolDefinitions: [customerTool, refundTool],
        });

        expect(plan.steps[1]?.toolCalls?.[0]?.args).toEqual({
            orderId: 'o_100',
            amount: { $fromStep: 's1', path: 'toolResults.0.data.creditAmount' },
        });
    });
});
