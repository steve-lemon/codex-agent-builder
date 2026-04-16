// Deterministic plan builders used by the fake LLM gateway.
import type { Plan } from '../agent/schemas';
import { getFlowDesignDefaultModel, getFlowDesignProbeDefaults } from '../flow-design/resources';
import { getFakePlanCopy } from './fake-copy';
import type { PlannerInput } from './types';

type EnsureToolAvailable = (toolName: string) => string;

/** Builds a deterministic research skill plan. */
export async function buildResearchBriefPlan(
    input: PlannerInput,
    ensureToolAvailable: EnsureToolAvailable,
): Promise<Plan> {
    const fakePlanCopy = await getFakePlanCopy();

    return {
        steps: [
            {
                id: 's1',
                mode: 'single-tool',
                description: fakePlanCopy.research.collectFactsDescription,
                toolCalls: [{ toolName: ensureToolAvailable('webSearch'), args: { query: input.userInput } }],
            },
            {
                id: 's2',
                mode: 'reasoning',
                description: fakePlanCopy.research.synthesizeDescription,
                reasoning: fakePlanCopy.research.synthesizeReasoning,
            },
            {
                id: 's3',
                mode: 'finalize',
                description: fakePlanCopy.research.finalizeDescription,
            },
        ],
    };
}

/** Builds a deterministic ops automation plan. */
export async function buildOpsAutomationPlan(ensureToolAvailable: EnsureToolAvailable): Promise<Plan> {
    const fakePlanCopy = await getFakePlanCopy();

    return {
        steps: [
            {
                id: 's1',
                mode: 'parallel-tools',
                description: fakePlanCopy.ops.readContextDescription,
                toolCalls: [
                    { toolName: ensureToolAvailable('getRefundPolicy'), args: {} },
                    { toolName: ensureToolAvailable('webSearch'), args: { query: fakePlanCopy.ops.statusQuery } },
                ],
            },
            {
                id: 's2',
                mode: 'single-tool',
                description: fakePlanCopy.ops.notifyDescription,
                toolCalls: [
                    {
                        toolName: ensureToolAvailable('sendSlackMessage'),
                        args: { channel: '#ops', message: fakePlanCopy.ops.slackMessage },
                    },
                ],
            },
            { id: 's3', mode: 'finalize', description: fakePlanCopy.ops.finalizeDescription },
        ],
    };
}

/** Builds a deterministic preflight validator plan. */
export async function buildFlowPreflightValidatorPlan(
    input: PlannerInput,
    ensureToolAvailable: EnsureToolAvailable,
): Promise<Plan> {
    const fakePlanCopy = await getFakePlanCopy();

    return {
        steps: [
            {
                id: 's1',
                mode: 'single-tool',
                description: fakePlanCopy.flowPreflight.inferTaskGraphDescription,
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
                description: fakePlanCopy.flowPreflight.analyzeCompatibilityDescription,
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
                description: fakePlanCopy.flowPreflight.proposeMissingBlocksDescription,
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
                description: fakePlanCopy.flowPreflight.prevalidateDescription,
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
                description: fakePlanCopy.flowPreflight.finalizeDescription,
            },
        ],
    };
}

/** Builds the deterministic node-config-designer plan. */
export async function buildNodeConfigDesignerPlan(): Promise<Plan> {
    const fakePlanCopy = await getFakePlanCopy();

    return {
        steps: [
            {
                id: 's1',
                mode: 'reasoning',
                description: fakePlanCopy.nodeConfig.reasoningDescription,
                reasoning: fakePlanCopy.nodeConfig.reasoning,
            },
            {
                id: 's2',
                mode: 'finalize',
                description: fakePlanCopy.nodeConfig.finalizeDescription,
            },
        ],
    };
}

/** Builds the deterministic flow-designer plan. */
export async function buildFlowDesignerPlan(
    input: PlannerInput,
    ensureToolAvailable: EnsureToolAvailable,
): Promise<Plan> {
    const fakePlanCopy = await getFakePlanCopy();
    const probeDefaults = await getFlowDesignProbeDefaults();
    const defaultModel = await getFlowDesignDefaultModel();
    const text = input.userInput.toLowerCase();
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
                    description: fakePlanCopy.flowDesigner.analyzeIntentDescription,
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
                    description: fakePlanCopy.flowDesigner.prevalidateDescription,
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
                    description: fakePlanCopy.flowDesigner.infeasibleStopDescription,
                    reasoning: fakePlanCopy.flowDesigner.infeasibleStopReasoning,
                },
                {
                    id: 's4',
                    mode: 'finalize',
                    description: fakePlanCopy.flowDesigner.infeasibleFinalizeDescription,
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
            description: fakePlanCopy.flowDesigner.analyzeIntentDescription,
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
            description: fakePlanCopy.flowDesigner.prevalidateDescription,
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
            description: fakePlanCopy.flowDesigner.probeDescription,
            toolCalls: [
                {
                    toolName: ensureToolAvailable('probeFlowBlock'),
                    args: {
                        blockId: 'ai-generate',
                        sampleConfig: {
                            model: probeDefaults.sampleConfig.model ?? defaultModel,
                            jsonOutput: String(input.userInput.toLowerCase().includes('json')),
                        },
                        sampleInputs: probeDefaults.sampleInputs,
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
                pass === 1 ? 'Configure the initial flow nodes' : `Reconfigure the revised flow nodes (${passLabel})`,
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
                pass === 1 ? 'Validate the initial flow draft' : `Validate the revised flow draft (${passLabel})`,
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
            description: pass === 1 ? 'Run the initial flow sample' : `Run the revised flow sample (${passLabel})`,
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
        description: fakePlanCopy.flowDesigner.finalizeDescription,
    });

    return {
        steps,
    };
}

/** Builds the default customer-support style plan. */
export async function buildCustomerSupportPlan(
    input: PlannerInput,
    ensureToolAvailable: EnsureToolAvailable,
): Promise<Plan> {
    const fakePlanCopy = await getFakePlanCopy();
    const text = input.userInput.toLowerCase();
    const requiresApproval = text.includes('refund') || text.includes('ticket') || text.includes('escalate');

    const steps: Plan['steps'] = [
        {
            id: 's1',
            mode: 'parallel-tools',
            description: fakePlanCopy.customerSupport.loadContextDescription,
            toolCalls: [
                { toolName: ensureToolAvailable('getCustomerById'), args: { customerId: 'c_1' } },
                { toolName: ensureToolAvailable('getOrdersByCustomer'), args: { customerId: 'c_1' } },
                { toolName: ensureToolAvailable('getRefundPolicy'), args: {} },
            ],
        },
        {
            id: 's2',
            mode: 'reasoning',
            description: fakePlanCopy.customerSupport.evaluateActionDescription,
            reasoning: fakePlanCopy.customerSupport.evaluateActionReasoning,
        },
    ];

    if (requiresApproval) {
        steps.push({
            id: 's3',
            mode: 'single-tool',
            description: fakePlanCopy.customerSupport.approvalActionDescription,
            toolCalls: [
                text.includes('refund')
                    ? { toolName: ensureToolAvailable('refundOrder'), args: { orderId: 'o_100', amount: 25 } }
                    : {
                          toolName: ensureToolAvailable('createTicket'),
                          args: { customerId: 'c_1', reason: fakePlanCopy.customerSupport.escalationReason },
                      },
            ],
        });
    }

    steps.push({
        id: `s${steps.length + 1}`,
        mode: 'finalize',
        description: fakePlanCopy.customerSupport.finalizeDescription,
    });

    return { steps };
}
