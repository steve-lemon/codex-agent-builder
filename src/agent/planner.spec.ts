// Vitest specs for planner grounding and validation behavior.
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Planner } from './planner';
import type { LlmGateway } from '../llm/types';
import { defineTool, buildToolManifest } from '../tools';
import { AgentError } from '../errors/agent-error';

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

    const flowValidationTool = defineTool({
        name: 'validateFlowDraft',
        description: 'Validate a drafted flow',
        parameters: z.object({
            flow: z.object({
                blocks: z.array(z.unknown()),
                nodes: z.array(z.unknown()),
                edges: z.array(z.unknown()),
            }),
        }),
        riskLevel: 'read-only',
        allowedSkills: ['flow-designer'],
        requiresConfirmation: false,
        parallelSafe: true,
        execute: async () => ({ valid: true }),
    });

    const nodeConfigDesignTool = defineTool({
        name: 'designFlowNodeConfigurations',
        description: 'Design node configurations for a drafted flow',
        parameters: z.object({
            userRequest: z.string(),
            flow: z.object({
                blocks: z.array(z.unknown()),
                nodes: z.array(z.unknown()),
                edges: z.array(z.unknown()),
            }),
            desiredCount: z.number(),
            wantsJson: z.boolean(),
        }),
        riskLevel: 'read-only',
        allowedSkills: ['flow-designer'],
        requiresConfirmation: false,
        parallelSafe: true,
        execute: async () => ({ flow: {} }),
    });

    const feasibilityTool = defineTool({
        name: 'assessFlowFeasibility',
        description: 'Assess whether a requested flow is feasible',
        parameters: z.object({
            userRequest: z.string(),
        }),
        riskLevel: 'read-only',
        allowedSkills: ['flow-designer'],
        requiresConfirmation: false,
        parallelSafe: true,
        execute: async () => ({ feasible: true, missingCapabilities: [], taskGraph: { nodes: [], edges: [] } }),
    });

    const designDraftTool = defineTool({
        name: 'designFlowDraft',
        description: 'Design a flow draft',
        parameters: z.object({
            userRequest: z.string(),
            sampleInput: z.string().optional(),
            desiredCount: z.number().optional(),
            wantsJson: z.boolean().optional(),
            preflight: z
                .object({
                    feasible: z.boolean(),
                    missingCapabilities: z.array(z.string()),
                    taskGraph: z.object({
                        nodes: z.array(z.unknown()),
                        edges: z.array(z.unknown()),
                    }),
                })
                .optional(),
        }),
        riskLevel: 'read-only',
        allowedSkills: ['flow-designer'],
        requiresConfirmation: false,
        parallelSafe: true,
        execute: async () => ({ flow: {} }),
    });

    it('passes grounded tool manifests to the gateway and returns a validated plan', async () => {
        const traceEvents: string[] = [];
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
            strategyBrief: {
                mission: 'Load customer context.',
                operationModel: ['extract'],
                executionPosture: 'hybrid',
                outputFormat: 'unspecified',
                confidenceCeiling: 'fulfilled',
                riskFlags: [],
                designPrinciples: [],
                sampleSource: 'user-provided',
            },
            allowedTools: ['getCustomerById', 'refundOrder'],
            toolManifests: [buildToolManifest(customerTool), buildToolManifest(refundTool)],
            toolDefinitions: [customerTool, refundTool],
            onTraceEvent: type => {
                traceEvents.push(type);
            },
        });

        expect(plan.steps[0]?.toolCalls?.[0]).toEqual({
            toolName: 'getCustomerById',
            args: { customerId: 'c_1' },
        });
        expect(llm.plan).toHaveBeenCalledWith(
            expect.objectContaining({
                strategyBrief: expect.objectContaining({
                    mission: 'Load customer context.',
                    executionPosture: 'hybrid',
                }),
            }),
        );
        expect(traceEvents).toEqual(
            expect.arrayContaining(['planner_llm_start', 'planner_llm_end', 'planner_validation_start', 'planner_validation_end']),
        );
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

    it('rejects inline flow payloads for downstream flow tools that must use step references', async () => {
        const llm: LlmGateway = {
            plan: async () => ({
                steps: [
                    {
                        id: 'draft',
                        mode: 'single-tool',
                        description: 'Validate draft',
                        toolCalls: [
                            {
                                toolName: 'validateFlowDraft',
                                args: {
                                    flow: {
                                        blocks: [{ id: 'blk-counter' }],
                                        nodes: [],
                                        edges: [],
                                    },
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

        await expect(
            planner.createPlan({
                userInput: 'Validate drafted flow',
                skillName: 'flow-designer',
                skillInstructions: 'Use flow tools only.',
                allowedTools: ['validateFlowDraft'],
                toolManifests: [buildToolManifest(flowValidationTool)],
                toolDefinitions: [flowValidationTool],
            }),
        ).rejects.toThrow(/validateFlowDraft\.flow via a step reference/);
    });

    it('repairs inline flow payloads by pointing at the nearest previous flow-producing step', async () => {
        const llm: LlmGateway = {
            plan: async () => ({
                steps: [
                    {
                        id: 'design_draft',
                        mode: 'single-tool',
                        description: 'Design draft',
                        toolCalls: [{ toolName: 'designFlowDraft', args: { userRequest: 'draw weather' } }],
                    },
                    {
                        id: 'validate_draft',
                        mode: 'single-tool',
                        description: 'Validate draft',
                        toolCalls: [
                            {
                                toolName: 'validateFlowDraft',
                                args: {
                                    flow: {
                                        blocks: [{ id: 'blk-counter' }],
                                        nodes: [],
                                        edges: [],
                                    },
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
            userInput: 'Validate drafted flow',
            skillName: 'flow-designer',
            skillInstructions: 'Use flow tools only.',
            allowedTools: ['designFlowDraft', 'validateFlowDraft'],
            toolManifests: [buildToolManifest(designDraftTool), buildToolManifest(flowValidationTool)],
            toolDefinitions: [designDraftTool, flowValidationTool],
        });

        expect(plan.steps[1]?.toolCalls?.[0]?.args).toEqual({
            flow: {
                $fromStep: 'design_draft',
                path: 'toolResults.0.data.flow',
            },
        });
    });

    it('repairs inline designFlowDraft preflight payloads by pointing at the nearest previous feasibility step', async () => {
        const llm: LlmGateway = {
            plan: async () => ({
                steps: [
                    {
                        id: 'assess_feasibility',
                        mode: 'single-tool',
                        description: 'Assess feasibility',
                        toolCalls: [{ toolName: 'assessFlowFeasibility', args: { userRequest: '그래프 설명' } }],
                    },
                    {
                        id: 'design_draft',
                        mode: 'single-tool',
                        description: 'Design draft',
                        toolCalls: [
                            {
                                toolName: 'designFlowDraft',
                                args: {
                                    userRequest: '그래프 설명',
                                    sampleInput: '{}',
                                    desiredCount: 1,
                                    wantsJson: false,
                                    preflight: {
                                        feasible: false,
                                        missingCapabilities: [],
                                        taskGraph: { nodes: [], edges: [] },
                                    },
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
            userInput: '그래프 설명',
            skillName: 'flow-designer',
            skillInstructions: 'Use flow tools only.',
            allowedTools: ['assessFlowFeasibility', 'designFlowDraft'],
            toolManifests: [buildToolManifest(feasibilityTool), buildToolManifest(designDraftTool)],
            toolDefinitions: [feasibilityTool, designDraftTool],
        });

        expect(plan.steps[1]?.toolCalls?.[0]?.args).toEqual({
            userRequest: '그래프 설명',
            sampleInput: '{}',
            desiredCount: 1,
            wantsJson: false,
            preflight: {
                $fromStep: 'assess_feasibility',
                path: 'toolResults.0.data',
            },
        });
    });

    it('accepts step references for downstream flow tools that consume prior draft results', async () => {
        const llm: LlmGateway = {
            plan: async () => ({
                steps: [
                    {
                        id: 'draft',
                        mode: 'single-tool',
                        description: 'Validate draft',
                        toolCalls: [
                            {
                                toolName: 'validateFlowDraft',
                                args: {
                                    flow: {
                                        $fromStep: 'design_draft',
                                        path: 'toolResults.0.data.flow',
                                    },
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
            userInput: 'Validate drafted flow',
            skillName: 'flow-designer',
            skillInstructions: 'Use flow tools only.',
            allowedTools: ['validateFlowDraft'],
            toolManifests: [buildToolManifest(flowValidationTool)],
            toolDefinitions: [flowValidationTool],
        });

        expect(plan.steps[0]?.toolCalls?.[0]?.args).toEqual({
            flow: {
                $fromStep: 'design_draft',
                path: 'toolResults.0.data.flow',
            },
        });
    });

    it('falls back to the deterministic node-config plan when planner args JSON parsing fails', async () => {
        const llm: LlmGateway = {
            plan: async () => {
                throw new AgentError('Planner returned invalid tool args JSON', {
                    code: 'PLAN_ARGS_JSON_INVALID',
                });
            },
            reflect: async () => ({ isComplete: true, reason: 'ok', missingItems: [] }),
            finalize: async () => ({ summary: 'done', success: true, nextActions: [] }),
            generateStructured: async () => {
                throw new Error('unused generateStructured mock');
            },
        };

        const planner = new Planner(llm);
        const plan = await planner.createPlan({
            userInput: 'ai 노드 설정을 설계해줘',
            skillName: 'node-config-designer',
            skillInstructions: 'Use node-config tools only.',
            allowedTools: [],
            toolManifests: [],
            toolDefinitions: [],
        });

        expect(plan.steps.map(step => step.mode)).toEqual(['reasoning', 'finalize']);
    });

    it('rejects referenced flow tool calls that omit other required args', async () => {
        const llm: LlmGateway = {
            plan: async () => ({
                steps: [
                    {
                        id: 'design_draft',
                        mode: 'single-tool',
                        description: 'Design draft',
                        toolCalls: [{ toolName: 'designFlowDraft', args: { userRequest: '자음과 모음을 나눠줘' } }],
                    },
                    {
                        id: 'configure_nodes',
                        mode: 'single-tool',
                        description: 'Configure nodes',
                        toolCalls: [
                            {
                                toolName: 'designFlowNodeConfigurations',
                                args: {
                                    flow: {
                                        $fromStep: 'design_draft',
                                        path: 'toolResults.0.data.flow',
                                    },
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

        await expect(
            planner.createPlan({
                userInput: 'Configure drafted flow',
                skillName: 'flow-designer',
                skillInstructions: 'Use flow tools only.',
                allowedTools: ['designFlowDraft', 'designFlowNodeConfigurations'],
                toolManifests: [buildToolManifest(designDraftTool), buildToolManifest(nodeConfigDesignTool)],
                toolDefinitions: [designDraftTool, nodeConfigDesignTool],
            }),
        ).rejects.toThrow(/Planner returned invalid args for designFlowNodeConfigurations/);
    });
});
