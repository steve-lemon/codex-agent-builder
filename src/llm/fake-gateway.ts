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

        if (input.skillName === 'node-config-designer') {
            return {
                steps: [
                    {
                        id: 's1',
                        mode: 'reasoning',
                        description: 'Explain how node configuration design is applied',
                        reasoning:
                            'This sub-agent configures an existing flow draft after the main flow structure already exists.',
                    },
                    {
                        id: 's2',
                        mode: 'finalize',
                        description: 'Finalize node-configuration guidance',
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
                            reasoning:
                                'Do not force a flow design when critical capabilities such as email access are unavailable.',
                        },
                        {
                            id: 's4',
                            mode: 'finalize',
                            description: 'Finalize capability-gap response',
                        },
                    ],
                };
            }

            const shouldUseExtendedRetryPolicy =
                text.includes('json') ||
                text.includes('여러') ||
                text.includes('multiple') ||
                text.includes('several') ||
                text.includes('titles') ||
                text.includes('타이틀') ||
                text.includes('제목');
            // TODO(flow-agent): Replace this keyword-based retry policy with a
            // planner-visible policy object so pass limits are explainable and
            // configurable per skill or request class.
            const maxDesignPasses = shouldUseExtendedRetryPolicy ? 3 : 2;
            const steps: Plan['steps'] = [
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
            ];

            let previousReflectionStepId: string | undefined;
            let currentPreflightStepId = 's2';
            let stepNumber = 4;

            for (let pass = 1; pass <= maxDesignPasses; pass += 1) {
                if (previousReflectionStepId) {
                    const refineStepId = `s${stepNumber++}`;
                    steps.push({
                        id: refineStepId,
                        mode: 'single-tool',
                        description: `Refine the task graph using reflection feedback (revision ${pass - 1})`,
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('refineTaskGraph'),
                                args: {
                                    taskGraph: {
                                        $fromStep: currentPreflightStepId,
                                        path: 'toolResults.0.data.taskGraph',
                                    },
                                    reflection: {
                                        issues: {
                                            $fromStep: previousReflectionStepId,
                                            path: 'toolResults.0.data.issues',
                                        },
                                        improvementNotes: {
                                            $fromStep: previousReflectionStepId,
                                            path: 'toolResults.0.data.improvementNotes',
                                        },
                                    },
                                },
                            },
                        ],
                    });

                    const reassessStepId = `s${stepNumber++}`;
                    steps.push({
                        id: reassessStepId,
                        mode: 'single-tool',
                        description: `Revalidate the refined task graph before redesign (revision ${pass - 1})`,
                        toolCalls: [
                            {
                                toolName: ensureToolAvailable('prevalidateFlowDesignRequest'),
                                args: {
                                    userRequest: input.userInput,
                                    taskGraph: { $fromStep: refineStepId, path: 'toolResults.0.data.taskGraph' },
                                },
                            },
                        ],
                    });

                    currentPreflightStepId = reassessStepId;
                }

                // TODO(flow-agent): Allow the planner to short-circuit remaining
                // passes when a reflection reports satisfaction instead of always
                // materializing the full deterministic loop upfront.
                const designStepId = `s${stepNumber++}`;
                const configureStepId = `s${stepNumber++}`;
                const validateConfigStepId = `s${stepNumber++}`;
                const validateStepId = `s${stepNumber++}`;
                const runStepId = `s${stepNumber++}`;
                const reflectStepId = `s${stepNumber++}`;
                const passLabel = pass === 1 ? 'initial' : `revision ${pass - 1}`;

                steps.push({
                    id: designStepId,
                    mode: 'single-tool',
                    description:
                        pass === 1
                            ? 'Design the initial flow draft'
                            : `Revise the flow draft using reflection feedback (${passLabel})`,
                    toolCalls: [
                        {
                            toolName: ensureToolAvailable('designFlowDraft'),
                            args: {
                                userRequest: input.userInput,
                                sampleInput: { $fromStep: 's1', path: 'toolResults.0.data.sampleInput' },
                                desiredCount: { $fromStep: 's1', path: 'toolResults.0.data.desiredCount' },
                                wantsJson: { $fromStep: 's1', path: 'toolResults.0.data.wantsJson' },
                                preflight: { $fromStep: currentPreflightStepId, path: 'toolResults.0.data' },
                                ...(previousReflectionStepId
                                    ? {
                                          improvementNotes: {
                                              $fromStep: previousReflectionStepId,
                                              path: 'toolResults.0.data.improvementNotes',
                                          },
                                      }
                                    : {}),
                            },
                        },
                    ],
                });

                steps.push({
                    id: configureStepId,
                    mode: 'single-tool',
                    description:
                        pass === 1
                            ? 'Configure the initial flow nodes'
                            : `Reconfigure the revised flow nodes (${passLabel})`,
                    toolCalls: [
                        {
                            toolName: ensureToolAvailable('designFlowNodeConfigurations'),
                            args: {
                                userRequest: input.userInput,
                                flow: { $fromStep: designStepId, path: 'toolResults.0.data.flow' },
                                desiredCount: { $fromStep: 's1', path: 'toolResults.0.data.desiredCount' },
                                wantsJson: { $fromStep: 's1', path: 'toolResults.0.data.wantsJson' },
                                probeResult: { $fromStep: 's3', path: 'toolResults.0.data' },
                                ...(previousReflectionStepId
                                    ? {
                                          strategyDirectives: {
                                              $fromStep: previousReflectionStepId,
                                              path: 'toolResults.0.data.nodeConfigStrategyDirectives',
                                          },
                                          strategyNotes: {
                                              $fromStep: previousReflectionStepId,
                                              path: 'toolResults.0.data.nodeConfigSkillImprovements',
                                          },
                                          improvementNotes: {
                                              $fromStep: previousReflectionStepId,
                                              path: 'toolResults.0.data.improvementNotes',
                                          },
                                      }
                                    : {}),
                            },
                        },
                    ],
                });

                steps.push({
                    id: validateConfigStepId,
                    mode: 'single-tool',
                    description:
                        pass === 1
                            ? 'Validate the initial node configurations'
                            : `Validate the revised node configurations (${passLabel})`,
                    toolCalls: [
                        {
                            toolName: ensureToolAvailable('validateFlowNodeConfigurations'),
                            args: {
                                flow: { $fromStep: configureStepId, path: 'toolResults.0.data.flow' },
                            },
                        },
                    ],
                });

                steps.push({
                    id: validateStepId,
                    mode: 'single-tool',
                    description:
                        pass === 1
                            ? 'Validate the initial flow draft'
                            : `Validate the revised flow draft (${passLabel})`,
                    toolCalls: [
                        {
                            toolName: ensureToolAvailable('validateFlowDraft'),
                            args: {
                                flow: { $fromStep: configureStepId, path: 'toolResults.0.data.flow' },
                            },
                        },
                    ],
                });

                steps.push({
                    id: runStepId,
                    mode: 'single-tool',
                    description:
                        pass === 1 ? 'Run the initial flow sample' : `Run the revised flow sample (${passLabel})`,
                    toolCalls: [
                        {
                            toolName: ensureToolAvailable('runFlowSample'),
                            args: {
                                userRequest: input.userInput,
                                flow: { $fromStep: configureStepId, path: 'toolResults.0.data.flow' },
                                ...(previousReflectionStepId
                                    ? {
                                          improvementNotes: {
                                              $fromStep: previousReflectionStepId,
                                              path: 'toolResults.0.data.improvementNotes',
                                          },
                                      }
                                    : {}),
                            },
                        },
                    ],
                });

                steps.push({
                    id: reflectStepId,
                    mode: 'single-tool',
                    description:
                        pass === 1
                            ? 'Reflect on the initial sample result'
                            : `Reflect on the revised sample result (${passLabel})`,
                    toolCalls: [
                        {
                            toolName: ensureToolAvailable('reflectFlowResult'),
                            args: {
                                userRequest: input.userInput,
                                desiredCount: { $fromStep: 's1', path: 'toolResults.0.data.desiredCount' },
                                wantsJson: { $fromStep: 's1', path: 'toolResults.0.data.wantsJson' },
                                sampleResult: { $fromStep: runStepId, path: 'toolResults.0.data' },
                            },
                        },
                    ],
                });

                previousReflectionStepId = reflectStepId;
            }

            steps.push({
                id: `s${stepNumber}`,
                mode: 'finalize',
                description: 'Finalize flow design response',
            });

            return {
                steps,
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
                        ? `Handled with skill flow-preflight-validator. The inferred task graph is not feasible with current blocks. Missing capabilities: ${(
                              preflightData?.missingCapabilities ?? []
                          ).join(', ')}.`
                        : 'Handled with skill flow-preflight-validator. The inferred task graph is feasible with the current blocks.',
                success: preflightData?.feasible !== false,
                nextActions:
                    preflightData?.feasible === false
                        ? [
                              `Review proposed blocks: ${(preflightData?.proposedBlocks ?? [])
                                  .map(block => block.blockId)
                                  .join(', ')}`,
                              `Add capabilities: ${(preflightData?.missingCapabilities ?? []).join(', ')}`,
                          ]
                        : ['Proceed to flow design'],
                designDetails: {
                    flowDesignImprovements:
                        preflightData?.feasible === false
                            ? [`Add capabilities: ${(preflightData?.missingCapabilities ?? []).join(', ')}`]
                            : [],
                    nodeConfigStrategyImprovements: [],
                },
            };
        }

        if (input.skillName === 'node-config-designer') {
            return {
                summary:
                    'Handled with skill node-config-designer. This sub-agent configures an existing flow draft after the main flow structure has been created.',
                success: true,
                nextActions: [
                    'Run this skill after flow-designer has produced a concrete flow draft.',
                    'Use designFlowNodeConfigurations and validateFlowNodeConfigurations on the draft flow.',
                ],
                designDetails: {
                    flowDesignImprovements: [],
                    nodeConfigStrategyImprovements: [
                        'Apply this sub-agent after the graph structure is stable.',
                        'Review block-specific strategies before executing the draft.',
                    ],
                },
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
            const reflections = input.stepResults.filter(step =>
                JSON.stringify(step).includes('"toolName":"reflectFlowResult"'),
            ) as Array<{
                toolResults?: Array<{
                    data?: {
                        satisfied?: boolean;
                        issues?: string[];
                        improvementNotes?: string[];
                        nodeConfigSkillImprovements?: string[];
                        nodeConfigStrategyDirectives?: Array<{
                            strategyId: string;
                            note: string;
                        }>;
                    };
                }>;
            }>;
            const refinedGraphs = input.stepResults.filter(step =>
                JSON.stringify(step).includes('"toolName":"refineTaskGraph"'),
            );
            const nodeConfigurations = input.stepResults.filter(step =>
                JSON.stringify(step).includes('"toolName":"designFlowNodeConfigurations"'),
            ) as Array<{
                toolResults?: Array<{
                    data?: {
                        suggestions?: Array<{ nodeId: string }>;
                        appliedStrategyIds?: string[];
                        nodeStrategyAssignments?: Array<{ nodeId: string; strategyId: string }>;
                        probeInsightsApplied?: string[];
                    };
                }>;
            }>;

            // TODO(flow-agent): Persist pass-by-pass design details instead of
            // only the last configured snapshot so UIs can show how strategy
            // assignments changed across retries.

            if (feasibilityData?.feasible === false) {
                const missingCapabilities = feasibilityData.missingCapabilities ?? [];
                return {
                    summary: `Handled with skill flow-designer. The request is not feasible with current blocks because these capabilities are missing: ${missingCapabilities.join(
                        ', ',
                    )}.`,
                    success: false,
                    nextActions: [
                        `Review proposed blocks: ${(feasibilityData.proposedBlocks ?? [])
                            .map(block => block.blockId)
                            .join(', ')}`,
                        `Add blocks or tools for: ${missingCapabilities.join(', ')}`,
                        'Retry flow design after the missing capabilities are available',
                    ],
                    designDetails: {
                        flowDesignImprovements: [
                            `Add missing capabilities before attempting another flow design pass: ${missingCapabilities.join(
                                ', ',
                            )}`,
                        ],
                        nodeConfigStrategyImprovements: [],
                    },
                };
            }

            const latestReflection = reflections[reflections.length - 1]?.toolResults?.[0]?.data;
            const designPasses = Math.max(reflections.length, 1);

            if (latestReflection?.satisfied === false) {
                const latestConfiguration = nodeConfigurations[nodeConfigurations.length - 1]?.toolResults?.[0]?.data;
                const latestNodeConfigImprovements = latestReflection.nodeConfigSkillImprovements ?? [];
                return {
                    summary: `Handled with skill flow-designer. The flow still needs improvement after ${designPasses} design pass(es) while configuring ${
                        latestConfiguration?.suggestions?.length ?? 0
                    } node(s).`,
                    success: false,
                    nextActions: [
                        ...(latestReflection.issues ?? [])
                            .slice(0, 2)
                            .map((issue: string) => `Address issue: ${issue}`),
                        ...(latestReflection.improvementNotes ?? [])
                            .slice(0, 2)
                            .map((note: string) => `Retry with improvement: ${note}`),
                        ...latestNodeConfigImprovements
                            .slice(0, 2)
                            .map((note: string) => `Update node-config strategy: ${note}`),
                    ],
                    designDetails: {
                        flowDesignImprovements: latestReflection.issues ?? [],
                        nodeConfigStrategyImprovements: latestNodeConfigImprovements,
                        appliedNodeConfigStrategies: latestConfiguration?.appliedStrategyIds ?? [],
                        nodeStrategyAssignments: latestConfiguration?.nodeStrategyAssignments ?? [],
                        configuredNodeCount: latestConfiguration?.suggestions?.length ?? 0,
                        probeInsightCount: latestConfiguration?.probeInsightsApplied?.length ?? 0,
                    },
                };
            }

            if (latestReflection?.satisfied === true) {
                const latestConfiguration = nodeConfigurations[nodeConfigurations.length - 1]?.toolResults?.[0]?.data;
                const configuredNodeCount = latestConfiguration?.suggestions?.length ?? 0;
                const probeInsightCount = latestConfiguration?.probeInsightsApplied?.length ?? 0;
                const latestNodeConfigImprovements = latestReflection.nodeConfigSkillImprovements ?? [];
                return {
                    summary: `Handled with skill flow-designer. The flow satisfied the request after ${designPasses} design pass(es), ${
                        refinedGraphs.length
                    } task-graph refinement step(s), and ${configuredNodeCount} configured node(s)${
                        probeInsightCount > 0 ? ` informed by ${probeInsightCount} probe insight(s)` : ''
                    }.`,
                    success: true,
                    nextActions:
                        designPasses > 1
                            ? ['Review the revised flow draft and keep the applied improvement notes for future runs']
                            : ['Review the generated flow and sample output'],
                    designDetails: {
                        flowDesignImprovements: latestReflection.improvementNotes ?? [],
                        nodeConfigStrategyImprovements: latestNodeConfigImprovements,
                        appliedNodeConfigStrategies: latestConfiguration?.appliedStrategyIds ?? [],
                        nodeStrategyAssignments: latestConfiguration?.nodeStrategyAssignments ?? [],
                        configuredNodeCount,
                        probeInsightCount,
                    },
                };
            }
        }

        return {
            summary: `Handled with skill ${input.skillName}. Processed ${input.stepResults.length} step results.`,
            success: true,
            nextActions: ['Review trace logs if needed'],
            designDetails: {
                flowDesignImprovements: [],
                nodeConfigStrategyImprovements: [],
            },
        };
    }
}
