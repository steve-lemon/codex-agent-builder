// LLM gateway interfaces and implementations.
import type { LlmGateway, PlannerInput, ReflectorInput, FinalizerInput } from './types';
import type { Plan } from '../agent/schemas';
import type { FinalResult } from '../agent/types';

/** Deterministic gateway that returns stable plans and summaries for tests and demos. */
export class FakeLlmGateway implements LlmGateway {
    async plan(input: PlannerInput): Promise<Plan> {
        const text = input.userInput.toLowerCase();
        const availableToolNames = new Set(input.toolManifests.map(tool => tool.name));

        const ensureToolAvailable = (toolName: string) => {
            if (!availableToolNames.has(toolName)) {
                throw new Error(`Fake planner attempted unavailable tool: ${toolName}`);
            }
            return toolName;
        };

        if (input.skillName === 'research-brief-generator') {
            return {
                steps: [
                    {
                        id: 's1',
                        mode: 'single-tool',
                        description: 'Collect research facts',
                        toolCalls: [{ toolName: ensureToolAvailable('webSearch'), args: { query: input.userInput } }],
                    },
                    {
                        id: 's2',
                        mode: 'reasoning',
                        description: 'Synthesize findings',
                        reasoning: 'Summarize key themes and caveats.',
                    },
                    {
                        id: 's3',
                        mode: 'finalize',
                        description: 'Finalize response',
                    },
                ],
            };
        }

        if (input.skillName === 'ops-automation-agent') {
            return {
                steps: [
                    {
                        id: 's1',
                        mode: 'parallel-tools',
                        description: 'Read policy and context in parallel',
                        toolCalls: [
                            { toolName: ensureToolAvailable('getRefundPolicy'), args: {} },
                            { toolName: ensureToolAvailable('webSearch'), args: { query: 'ops status' } },
                        ],
                    },
                    {
                        id: 's2',
                        mode: 'single-tool',
                        description: 'Notify channel',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('sendSlackMessage'),
                                args: { channel: '#ops', message: 'Daily automation summary ready.' },
                            },
                        ],
                    },
                    { id: 's3', mode: 'finalize', description: 'Finalize response' },
                ],
            };
        }

        if (input.skillName === 'flow-preflight-validator') {
            return {
                steps: [
                    {
                        id: 's1',
                        mode: 'single-tool',
                        description: 'Infer the task graph from the request',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('inferTaskGraph'),
                                args: { userRequest: input.userInput },
                            },
                        ],
                    },
                    {
                        id: 's2',
                        mode: 'single-tool',
                        description: 'Analyze graph compatibility against current blocks',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('analyzeTaskGraphCompatibility'),
                                args: {
                                    taskGraph: { $fromStep: 's1', path: 'toolResults.0.data.taskGraph' },
                                },
                            },
                        ],
                    },
                    {
                        id: 's3',
                        mode: 'single-tool',
                        description: 'Draft any missing blocks implied by the graph',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('proposeMissingBlocks'),
                                args: {
                                    nodeAnalyses: { $fromStep: 's2', path: 'toolResults.0.data.nodeAnalyses' },
                                },
                            },
                        ],
                    },
                    {
                        id: 's4',
                        mode: 'single-tool',
                        description: 'Produce a full preflight validation summary',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('prevalidateFlowDesignRequest'),
                                args: { userRequest: input.userInput },
                            },
                        ],
                    },
                    {
                        id: 's5',
                        mode: 'finalize',
                        description: 'Finalize preflight validation response',
                    },
                ],
            };
        }

        if (input.skillName === 'flow-designer') {
            const isClearlyInfeasible =
                text.includes('email') ||
                text.includes('mail') ||
                text.includes('reply') ||
                text.includes('이메일') ||
                text.includes('답장');

            if (isClearlyInfeasible) {
                return {
                    steps: [
                        {
                            id: 's1',
                            mode: 'single-tool',
                            description: 'Analyze request intent for flow design',
                            toolCalls: [
                                {
                                    toolName: ensureToolAvailable('analyzeFlowRequest'),
                                    args: { userRequest: input.userInput },
                                },
                            ],
                        },
                        {
                            id: 's2',
                            mode: 'single-tool',
                            description: 'Run graph-based preflight validation before attempting flow design',
                            toolCalls: [
                                {
                                    toolName: ensureToolAvailable('prevalidateFlowDesignRequest'),
                                    args: { userRequest: input.userInput },
                                },
                            ],
                        },
                        {
                            id: 's3',
                            mode: 'reasoning',
                            description: 'Stop before design because required capabilities are missing',
                            reasoning: 'Do not force a flow design when critical capabilities such as email access are unavailable.',
                        },
                        {
                            id: 's4',
                            mode: 'finalize',
                            description: 'Finalize capability-gap response',
                        },
                    ],
                };
            }

            return {
                steps: [
                    {
                        id: 's1',
                        mode: 'single-tool',
                        description: 'Analyze request intent for flow design',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('analyzeFlowRequest'),
                                args: { userRequest: input.userInput },
                            },
                        ],
                    },
                    {
                        id: 's2',
                        mode: 'single-tool',
                        description: 'Run graph-based preflight validation before flow design',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('prevalidateFlowDesignRequest'),
                                args: { userRequest: input.userInput },
                            },
                        ],
                    },
                    {
                        id: 's3',
                        mode: 'single-tool',
                        description: 'Probe the AI block behavior before using it',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('probeFlowBlock'),
                                args: {
                                    blockId: 'ai-generate',
                                    sampleConfig: {
                                        model: 'mock-flow-model',
                                        jsonOutput: String(input.userInput.toLowerCase().includes('json')),
                                    },
                                    sampleInputs: {
                                        system: 'You generate clear and catchy blog titles based on one keyword.',
                                        prompt: 'User request: sample. Sample input: 샘플 입력. Return one result. Return plain text.',
                                    },
                                },
                            },
                        ],
                    },
                    {
                        id: 's4',
                        mode: 'single-tool',
                        description: 'Design a flow draft',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('designFlowDraft'),
                                args: {
                                    userRequest: input.userInput,
                                    sampleInput: { $fromStep: 's1', path: 'toolResults.0.data.sampleInput' },
                                    desiredCount: { $fromStep: 's1', path: 'toolResults.0.data.desiredCount' },
                                    wantsJson: { $fromStep: 's1', path: 'toolResults.0.data.wantsJson' },
                                    preflight: { $fromStep: 's2', path: 'toolResults.0.data' },
                                },
                            },
                        ],
                    },
                    {
                        id: 's5',
                        mode: 'single-tool',
                        description: 'Validate the flow draft',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('validateFlowDraft'),
                                args: {
                                    flow: { $fromStep: 's4', path: 'toolResults.0.data.flow' },
                                },
                            },
                        ],
                    },
                    {
                        id: 's6',
                        mode: 'single-tool',
                        description: 'Run the flow sample',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('runFlowSample'),
                                args: {
                                    userRequest: input.userInput,
                                    flow: { $fromStep: 's4', path: 'toolResults.0.data.flow' },
                                },
                            },
                        ],
                    },
                    {
                        id: 's7',
                        mode: 'single-tool',
                        description: 'Reflect on the sample result',
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('reflectFlowResult'),
                                args: {
                                    userRequest: input.userInput,
                                    desiredCount: { $fromStep: 's1', path: 'toolResults.0.data.desiredCount' },
                                    wantsJson: { $fromStep: 's1', path: 'toolResults.0.data.wantsJson' },
                                    sampleResult: { $fromStep: 's6', path: 'toolResults.0.data' },
                                },
                            },
                        ],
                    },
                    {
                        id: 's8',
                        mode: 'finalize',
                        description: 'Finalize flow design response',
                    },
                ],
            };
        }

        const requiresApproval = text.includes('refund') || text.includes('ticket') || text.includes('escalate');

        const steps: Plan['steps'] = [
            {
                id: 's1',
                mode: 'parallel-tools',
                description: 'Load customer context in parallel',
                toolCalls: [
                    { toolName: ensureToolAvailable('getCustomerById'), args: { customerId: 'c_1' } },
                    { toolName: ensureToolAvailable('getOrdersByCustomer'), args: { customerId: 'c_1' } },
                    { toolName: ensureToolAvailable('getRefundPolicy'), args: {} },
                ],
            },
            {
                id: 's2',
                mode: 'reasoning',
                description: 'Evaluate support action',
                reasoning: 'Use policy and order history to decide whether escalation/refund is needed.',
            },
        ];

        if (requiresApproval) {
            steps.push({
                id: 's3',
                mode: 'single-tool',
                description: 'Execute approval-required action',
                toolCalls: [
                    text.includes('refund')
                        ? { toolName: ensureToolAvailable('refundOrder'), args: { orderId: 'o_100', amount: 25 } }
                        : {
                              toolName: ensureToolAvailable('createTicket'),
                              args: { customerId: 'c_1', reason: 'Escalation requested by agent' },
                          },
                ],
            });
        }

        steps.push({ id: 's4', mode: 'finalize', description: 'Finalize response' });

        return { steps };
    }

    async reflect(input: ReflectorInput) {
        const hasFailure = JSON.stringify(input.stepResults).includes('"ok":false');
        return {
            isComplete: true,
            reason: hasFailure ? 'Completed with tool errors' : 'All planned steps executed',
            missingItems: [],
        };
    }

    async finalize(input: FinalizerInput): Promise<FinalResult> {
        if (input.skillName === 'flow-preflight-validator') {
            const preflight = input.stepResults.find(step =>
                JSON.stringify(step).includes('"toolName":"prevalidateFlowDesignRequest"'),
            ) as
                | {
                      toolResults?: Array<{
                          data?: {
                              feasible?: boolean;
                              missingCapabilities?: string[];
                              proposedBlocks?: Array<{ blockId: string }>;
                          };
                      }>;
                  }
                | undefined;
            const preflightData = preflight?.toolResults?.[0]?.data;

            return {
                summary:
                    preflightData?.feasible === false
                        ? `Handled with skill flow-preflight-validator. The inferred task graph is not feasible with current blocks. Missing capabilities: ${(preflightData?.missingCapabilities ?? []).join(', ')}.`
                        : 'Handled with skill flow-preflight-validator. The inferred task graph is feasible with the current blocks.',
                success: preflightData?.feasible !== false,
                nextActions:
                    preflightData?.feasible === false
                        ? [
                              `Review proposed blocks: ${(preflightData?.proposedBlocks ?? []).map(block => block.blockId).join(', ')}`,
                              `Add capabilities: ${(preflightData?.missingCapabilities ?? []).join(', ')}`,
                          ]
                        : ['Proceed to flow design'],
            };
        }

        if (input.skillName === 'flow-designer') {
            const feasibility = input.stepResults.find(step =>
                JSON.stringify(step).includes('"toolName":"prevalidateFlowDesignRequest"'),
            ) as
                | {
                      toolResults?: Array<{
                          data?: {
                              feasible?: boolean;
                              missingCapabilities?: string[];
                              proposedBlocks?: Array<{ blockId: string }>;
                          };
                      }>;
                  }
                | undefined;
            const feasibilityData = feasibility?.toolResults?.[0]?.data;

            if (feasibilityData?.feasible === false) {
                const missingCapabilities = feasibilityData.missingCapabilities ?? [];
                return {
                    summary: `Handled with skill flow-designer. The request is not feasible with current blocks because these capabilities are missing: ${missingCapabilities.join(', ')}.`,
                    success: false,
                    nextActions: [
                        `Review proposed blocks: ${(feasibilityData.proposedBlocks ?? []).map(block => block.blockId).join(', ')}`,
                        `Add blocks or tools for: ${missingCapabilities.join(', ')}`,
                        'Retry flow design after the missing capabilities are available',
                    ],
                };
            }
        }

        return {
            summary: `Handled with skill ${input.skillName}. Processed ${input.stepResults.length} step results.`,
            success: true,
            nextActions: ['Review trace logs if needed'],
        };
    }
}
