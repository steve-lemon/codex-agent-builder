// Flow-design tool wrappers built on the shared flow-design core.
import { z } from 'zod';
import { AgentError } from '../../errors/agent-error';
import {
    executeFlowDesignSample,
    probeFlowBlockRuntime,
    proposeBlockSpecUpdate,
    validateDesignedFlow,
    normalizeFlowRequest,
} from '../design/core';
import { buildDesignBrief } from '../design/architecture';
import { getCatalogAvailableFlowBlocks } from '../design/catalog';
import { defaultFlowDesignProvider, type FlowDesignProvider } from '../design/provider';
import { createFlowDesignTaskTypeAdvisor } from '../design/task-types';
import { createFlowDesignTaskGraphAdvisor } from '../design/task-graphs';
import type { FlowDocument } from '../types';
import { buildToolPackFromResource, loadToolPackResource } from '../../tools/core/resources';
import {
    defineTool,
    type ToolContext,
    type ToolDefinition,
    type ToolPack,
    type ToolRepositoryBundle,
} from '../../tools/core/types';
import type { FlowFeasibilityAssessment } from '../design/analysis';
import { assessFlowFeasibility } from '../design/analysis';
import { createFlowAiDelegationAdvisor } from '../design/ai-delegation';

const FlowPortSchema = z.object({
    id: z.string(),
    nodeId: z.string().default(''),
    localId: z.string(),
    direction: z.enum(['input', 'output']),
    dataType: z.enum(['text', 'json', 'image', 'number', 'any']),
    label: z.string(),
});

const FlowNodeSchema = z.object({
    id: z.string(),
    blockId: z.string(),
    label: z.string(),
    config: z.record(z.string()).optional(),
    inputPorts: z.array(FlowPortSchema),
    outputPorts: z.array(FlowPortSchema),
});

const FlowEdgeSchema = z.object({
    id: z.string(),
    sourceNodeId: z.string(),
    sourcePortId: z.string(),
    targetNodeId: z.string(),
    targetPortId: z.string(),
    label: z.string().optional(),
});

const FlowBlockSchema = z.object({
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    configs: z
        .array(
            z.object({
                id: z.string(),
                label: z.string(),
                hint: z.enum(['text', 'select', 'checkbox', 'number']),
                required: z.boolean().optional(),
                defaultValue: z.string().optional(),
            }),
        )
        .optional(),
    inputs: z.array(
        z.object({
            localId: z.string(),
            label: z.string(),
            direction: z.literal('input'),
            dataType: z.enum(['text', 'json', 'image', 'number', 'any']),
        }),
    ),
    outputs: z.array(
        z.object({
            localId: z.string(),
            label: z.string(),
            direction: z.literal('output'),
            dataType: z.enum(['text', 'json', 'image', 'number', 'any']),
        }),
    ),
});

const FlowDocumentSchema = z.object({
    blocks: z.array(FlowBlockSchema),
    nodes: z.array(FlowNodeSchema),
    edges: z.array(FlowEdgeSchema),
});

const TaskGraphSchema = z.object({
    nodes: z.array(
        z.object({
            id: z.string(),
            label: z.string().optional(),
            data: z.record(z.unknown()).optional(),
        }),
    ),
    edges: z.array(
        z.object({
            source: z.string(),
            target: z.string(),
            label: z.string().optional(),
            data: z.record(z.unknown()).optional(),
        }),
    ),
});

const PreflightSummarySchema = z.object({
    feasible: z.boolean(),
    requiredCapabilities: z.array(z.string()),
    availableCapabilities: z.array(z.string()),
    missingCapabilities: z.array(z.string()),
    reason: z.string(),
    recommendedAction: z.string(),
    taskGraph: TaskGraphSchema,
    nodeAnalyses: z.array(
        z.object({
            nodeId: z.string(),
            operation: z.string(),
            expectedInputs: z.array(z.string()),
            expectedOutputs: z.array(z.string()),
            requiredCapabilities: z.array(z.string()),
            matchedBlockIds: z.array(z.string()),
            feasible: z.boolean(),
            reasons: z.array(z.string()),
        }),
    ),
    proposedBlocks: z.array(
        z.object({
            blockId: z.string(),
            purpose: z.string(),
            requiredCapabilities: z.array(z.string()),
            suggestedInputs: z.array(
                z.object({
                    localId: z.string(),
                    dataType: z.string(),
                    description: z.string(),
                }),
            ),
            suggestedOutputs: z.array(
                z.object({
                    localId: z.string(),
                    dataType: z.string(),
                    description: z.string(),
                }),
            ),
            suggestedConfigs: z.array(
                z.object({
                    id: z.string(),
                    hint: z.string(),
                    required: z.boolean(),
                    description: z.string(),
                }),
            ),
        }),
    ),
});

async function hydrateFlowDocument(flow: FlowDocument): Promise<FlowDocument> {
    const availableFlowBlocks = await getCatalogAvailableFlowBlocks();
    const availableBlockMap = new Map(availableFlowBlocks.map(block => [block.id, block]));
    const unknownBlockIds = flow.nodes.map(node => node.blockId).filter(blockId => !availableBlockMap.has(blockId));

    if (unknownBlockIds.length > 0) {
        throw new AgentError(
            `Flow document references unknown blocks: ${Array.from(new Set(unknownBlockIds)).join(', ')}`,
            {
                code: 'FLOW_UNKNOWN_BLOCKS',
            },
        );
    }

    return {
        ...flow,
        blocks:
            flow.blocks.length > 0
                ? flow.blocks
                      .map(block => availableBlockMap.get(block.id))
                      .filter((block): block is NonNullable<typeof block> => block !== undefined)
                : availableFlowBlocks,
        nodes: flow.nodes.map(node => ({
            ...node,
            inputPorts: node.inputPorts.map(port => ({
                ...port,
                nodeId: port.nodeId || node.id,
            })),
            outputPorts: node.outputPorts.map(port => ({
                ...port,
                nodeId: port.nodeId || node.id,
            })),
        })),
    };
}

function buildNodeConfigSkillImprovements(args: {
    userRequest: string;
    desiredCount: number;
    wantsJson: boolean;
    issues: string[];
}): {
    nodeConfigSkillImprovements: string[];
    nodeConfigStrategyDirectives: Array<{ strategyId: string; note: string }>;
} {
    const nodeConfigSkillImprovements: string[] = [];
    const nodeConfigStrategyDirectives: Array<{ strategyId: string; note: string }> = [];
    const lowered = args.userRequest.toLowerCase();

    // TODO(flow-agent): Replace this heuristic issue-to-strategy routing with a
    // richer reflection model that can point to concrete nodes and evidence.
    if (args.wantsJson) {
        nodeConfigSkillImprovements.push(
            'Prefer a structured-output model profile and stricter system instructions for JSON mode.',
        );
        nodeConfigStrategyDirectives.push({
            strategyId: 'ai-generation',
            note: 'Prefer a structured-output model profile and stricter system instructions for JSON mode.',
        });
    }
    if (args.desiredCount > 1) {
        nodeConfigSkillImprovements.push(
            `Tune the prompt-input node so the AI block is explicitly asked for exactly ${args.desiredCount} outputs.`,
        );
        nodeConfigStrategyDirectives.push({
            strategyId: 'prompt-input',
            note: `Ask for exactly ${args.desiredCount} outputs with explicit count wording.`,
        });
    }
    if (
        lowered.includes('blog') ||
        lowered.includes('title') ||
        lowered.includes('타이틀') ||
        lowered.includes('제목')
    ) {
        nodeConfigSkillImprovements.push(
            'Strengthen the system-input node to emphasize publishable headline quality and distinct title phrasing.',
        );
        nodeConfigStrategyDirectives.push({
            strategyId: 'system-input',
            note: 'Emphasize publishable headline quality and distinct title phrasing.',
        });
    }
    if (args.issues.some(issue => issue.toLowerCase().includes('status'))) {
        nodeConfigSkillImprovements.push(
            'Review buffer/view node settings so execution remains observable and deterministic during retries.',
        );
        nodeConfigStrategyDirectives.push({
            strategyId: 'buffer-timing',
            note: 'Keep execution timing explicit and deterministic during retries.',
        });
        nodeConfigStrategyDirectives.push({
            strategyId: 'view-observer',
            note: 'Keep output observation visible while retrying failed runs.',
        });
    }

    return {
        nodeConfigSkillImprovements,
        nodeConfigStrategyDirectives,
    };
}

function defineFlowToolExecutor<TArgs extends Record<string, unknown>>(
    handler: (args: TArgs, context: ToolContext) => Promise<unknown> | unknown,
) {
    return async (args: Record<string, unknown>, context: ToolContext) => {
        return await handler(args as TArgs, context);
    };
}

const FLOW_DESIGN_EXECUTE_IDS = {
    analyzeFlowRequest: 'flow-design.analyze-request',
    listAvailableFlowBlocks: 'flow-design.list-available-blocks',
    assessFlowFeasibility: 'flow-design.assess-feasibility',
    probeFlowBlock: 'flow-design.probe-block',
    designFlowDraft: 'flow-design.design-draft',
    validateFlowDraft: 'flow-design.validate-draft',
    proposeBlockSpecUpdate: 'flow-design.propose-block-spec-update',
    runFlowSample: 'flow-design.run-sample',
    reflectFlowResult: 'flow-design.reflect-result',
} as const;

/** Returns deterministic tools and executor mappings used by the flow-designer skill. */
export async function createFlowDesignToolBundle(
    options: {
        provider?: FlowDesignProvider;
    } = {},
): Promise<ToolRepositoryBundle> {
    const provider = options.provider ?? defaultFlowDesignProvider;

    const codeTools: ToolDefinition[] = [
        defineTool({
            name: 'analyzeFlowRequest',
            description: 'Analyze a user request into flow-design intent, constraints, and success criteria.',
            parameters: z.object({
                userRequest: z.string(),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: true,
            executeId: FLOW_DESIGN_EXECUTE_IDS.analyzeFlowRequest,
        }),
        defineTool({
            name: 'listAvailableFlowBlocks',
            description: 'List the available flow blocks with ports and config schemas.',
            parameters: z.object({
                includeIds: z.array(z.string()).optional(),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: true,
            executeId: FLOW_DESIGN_EXECUTE_IDS.listAvailableFlowBlocks,
        }),
        defineTool({
            name: 'assessFlowFeasibility',
            description:
                'Check whether the current block set can satisfy the request, and report missing capabilities early.',
            parameters: z.object({
                userRequest: z.string(),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: true,
            executeId: FLOW_DESIGN_EXECUTE_IDS.assessFlowFeasibility,
        }),
        defineTool({
            name: 'probeFlowBlock',
            description:
                'Run a deterministic probe against one executable block to observe its actual runtime behavior.',
            parameters: z.object({
                blockId: z.string(),
                sampleConfig: z.record(z.string()).optional(),
                sampleInputs: z.record(z.unknown()).optional(),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: false,
            executeId: FLOW_DESIGN_EXECUTE_IDS.probeFlowBlock,
        }),
        defineTool({
            name: 'designFlowDraft',
            description:
                'Create a flow draft using only the available flow blocks, grounded by preflight validation and optional improvement notes.',
            parameters: z.object({
                userRequest: z.string(),
                sampleInput: z.string(),
                desiredCount: z.number().int().positive(),
                wantsJson: z.boolean(),
                improvementNotes: z.array(z.string()).optional(),
                preflight: PreflightSummarySchema.optional(),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: false,
            executeId: FLOW_DESIGN_EXECUTE_IDS.designFlowDraft,
        }),
        defineTool({
            name: 'validateFlowDraft',
            description: 'Validate a flow draft and confirm that it can be planned for execution.',
            parameters: z.object({
                flow: FlowDocumentSchema,
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: true,
            executeId: FLOW_DESIGN_EXECUTE_IDS.validateFlowDraft,
        }),
        defineTool({
            name: 'proposeBlockSpecUpdate',
            description:
                'Generate a documentation update proposal when block probing reveals missing or unclear behavior details.',
            parameters: z.object({
                blockId: z.string(),
                probeResult: z.object({
                    behaviorNotes: z.array(z.string()),
                    mismatchesFromSpec: z.array(z.string()),
                    observedOutputs: z.record(z.unknown()).optional(),
                    observedLogs: z.array(z.string()).optional(),
                }),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: true,
            executeId: FLOW_DESIGN_EXECUTE_IDS.proposeBlockSpecUpdate,
        }),
        defineTool({
            name: 'runFlowSample',
            description: 'Run a deterministic sample execution of a flow draft and return the final output plus logs.',
            parameters: z.object({
                userRequest: z.string(),
                flow: FlowDocumentSchema,
                improvementNotes: z.array(z.string()).optional(),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: false,
            executeId: FLOW_DESIGN_EXECUTE_IDS.runFlowSample,
        }),
        defineTool({
            name: 'reflectFlowResult',
            description: 'Reflect on whether the sample flow output satisfies the original user request.',
            parameters: z.object({
                userRequest: z.string(),
                desiredCount: z.number().int().positive(),
                wantsJson: z.boolean(),
                sampleResult: z.object({
                    status: z.enum(['completed', 'failed', 'cancelled']),
                    output: z.unknown().optional(),
                    logs: z.array(z.string()),
                }),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer'],
            requiresConfirmation: false,
            parallelSafe: true,
            executeId: FLOW_DESIGN_EXECUTE_IDS.reflectFlowResult,
        }),
    ];

    const resource = await loadToolPackResource('tools.flow-design.set');
    const pack = buildToolPackFromResource(
        resource,
        Object.fromEntries(
            codeTools.map(tool => [
                tool.name,
                {
                    name: tool.name,
                    parameters: tool.parameters,
                },
            ]),
        ),
    );
    const tools = pack.bundle.tools;

    const executors = {
        [FLOW_DESIGN_EXECUTE_IDS.analyzeFlowRequest]: defineFlowToolExecutor<{ userRequest: string }>(
            async ({ userRequest }, context) => {
                const normalizedRequest = await normalizeFlowRequest(userRequest, {
                    taskTypeAdvisor: createFlowDesignTaskTypeAdvisor(context.llm),
                });
                const designBrief = await buildDesignBrief(normalizedRequest);
                const representativeSample = designBrief.validationPlan.sampleCases[0];
                const rawInput = representativeSample?.input;
                const sampleInput =
                    typeof rawInput === 'string'
                        ? rawInput
                        : rawInput === undefined
                        ? '샘플 입력'
                        : JSON.stringify(rawInput);
                return {
                    taskType: normalizedRequest.taskType,
                    outputContract: normalizedRequest.outputContract,
                    wantsJson: normalizedRequest.wantsJson,
                    wantsMultiple: normalizedRequest.wantsMultiple,
                    desiredCount: normalizedRequest.desiredCount,
                    sampleInput,
                    sampleInputSource:
                        designBrief.inputContract.source === 'synthetic' ? 'synthetic-graph-json' : 'default',
                    sampleInputReadyForDesign: true,
                    constraints: ['Use only available blocks from the repository.'],
                    guidanceNotes:
                        designBrief.inputContract.source === 'synthetic'
                            ? [
                                  'A synthetic graph JSON sample is already available for drafting and sample validation.',
                                  'Do not stop early just because the user did not paste the concrete graph JSON yet; use the synthetic sample to continue the design pass.',
                              ]
                            : [],
                    successCriteria:
                        normalizedRequest.desiredCount > 1
                            ? [`Produce ${normalizedRequest.desiredCount} useful outputs.`]
                            : ['Produce one useful output.'],
                    designBrief,
                };
            },
        ),
        [FLOW_DESIGN_EXECUTE_IDS.listAvailableFlowBlocks]: defineFlowToolExecutor<{ includeIds?: string[] }>(
            async ({ includeIds }) => {
                const availableFlowBlocks = await getCatalogAvailableFlowBlocks();
                const ids = includeIds ? new Set(includeIds as string[]) : undefined;
                return availableFlowBlocks
                    .filter(block => !ids || ids.has(block.id))
                    .map(block => ({
                        id: block.id,
                        label: block.label,
                        description: block.description,
                        configs: block.configs ?? [],
                        inputs: block.inputs,
                        outputs: block.outputs,
                    }));
            },
        ),
        [FLOW_DESIGN_EXECUTE_IDS.assessFlowFeasibility]: defineFlowToolExecutor<{ userRequest: string }>(
            async ({ userRequest }, context) => {
                const normalizedRequest = await normalizeFlowRequest(userRequest as string, {
                    taskTypeAdvisor: createFlowDesignTaskTypeAdvisor(context.llm),
                });
                const designBrief = await buildDesignBrief(normalizedRequest);
                return await assessFlowFeasibility(userRequest as string, {
                    aiDelegationAdvisor: createFlowAiDelegationAdvisor(context.llm),
                    taskGraphAdvisor: createFlowDesignTaskGraphAdvisor(context.llm),
                    taskType: normalizedRequest.taskType,
                    operationModel: designBrief.mission.operationModel,
                });
            },
        ),
        [FLOW_DESIGN_EXECUTE_IDS.probeFlowBlock]: defineFlowToolExecutor<{
            blockId: string;
            sampleConfig?: Record<string, string>;
            sampleInputs?: Record<string, unknown>;
        }>(async ({ blockId, sampleConfig, sampleInputs }) => {
            return await probeFlowBlockRuntime({
                blockId: blockId as string,
                sampleConfig: sampleConfig as Record<string, string> | undefined,
                sampleInputs: sampleInputs as Record<string, unknown> | undefined,
                availableBlocks: await getCatalogAvailableFlowBlocks(),
            });
        }),
        [FLOW_DESIGN_EXECUTE_IDS.designFlowDraft]: defineFlowToolExecutor<{
            userRequest: string;
            sampleInput: string;
            desiredCount: number;
            wantsJson: boolean;
            improvementNotes?: string[];
            preflight?: FlowFeasibilityAssessment;
        }>(async ({ userRequest, sampleInput, desiredCount, wantsJson, improvementNotes = [], preflight }, context) => {
            const normalizedRequest = await normalizeFlowRequest(userRequest as string, {
                taskTypeAdvisor: createFlowDesignTaskTypeAdvisor(context.llm),
            });
            const designBrief = await buildDesignBrief(normalizedRequest);
            const feasibility =
                (preflight as FlowFeasibilityAssessment | undefined) ??
                (await assessFlowFeasibility(userRequest as string, {
                    aiDelegationAdvisor: createFlowAiDelegationAdvisor(context.llm),
                    taskGraphAdvisor: createFlowDesignTaskGraphAdvisor(context.llm),
                    taskType: normalizedRequest.taskType,
                    operationModel: designBrief.mission.operationModel,
                }));
            return await Promise.resolve(
                provider.composeDraft({
                    userRequest: userRequest as string,
                    sampleInput: sampleInput as string,
                    desiredCount: desiredCount as number,
                    wantsJson: wantsJson as boolean,
                    improvementNotes: improvementNotes as string[],
                    preflight: feasibility,
                    availableBlocks: await getCatalogAvailableFlowBlocks(),
                    designConnection: context.designConnection,
                    designSessionId: `${context.runId}:designFlowDraft`,
                    toolName: 'designFlowDraft',
                }),
            );
        }),
        [FLOW_DESIGN_EXECUTE_IDS.validateFlowDraft]: defineFlowToolExecutor<{ flow: FlowDocument }>(
            async ({ flow }) => {
                const validation = validateDesignedFlow(await hydrateFlowDocument(flow as FlowDocument));
                return {
                    isValid: validation.isValid,
                    issues: validation.issues,
                    planSummary: validation.plan
                        ? {
                              batchCount: validation.plan.batches.length,
                              nodeCount: validation.plan.nodes.length,
                          }
                        : undefined,
                };
            },
        ),
        [FLOW_DESIGN_EXECUTE_IDS.proposeBlockSpecUpdate]: defineFlowToolExecutor<{
            blockId: string;
            probeResult: {
                behaviorNotes: string[];
                mismatchesFromSpec: string[];
                observedOutputs?: Record<string, unknown>;
                observedLogs?: string[];
            };
        }>(async ({ blockId, probeResult }) => {
            return proposeBlockSpecUpdate({
                blockId: blockId as string,
                probeResult: probeResult as {
                    behaviorNotes: string[];
                    mismatchesFromSpec: string[];
                    observedOutputs?: Record<string, unknown>;
                    observedLogs?: string[];
                },
                availableBlocks: await getCatalogAvailableFlowBlocks(),
            });
        }),
        [FLOW_DESIGN_EXECUTE_IDS.runFlowSample]: defineFlowToolExecutor<{
            userRequest: string;
            flow: FlowDocument;
            improvementNotes?: string[];
        }>(async ({ userRequest, flow, improvementNotes = [] }) => {
            const execution = await executeFlowDesignSample({
                flow: await hydrateFlowDocument(flow as FlowDocument),
                userRequest: userRequest as string,
                improvementNotes: improvementNotes as string[],
            });

            return {
                status: execution.status,
                output: execution.output,
                logs: execution.logs,
                executionOrder: execution.graphRun.executionOrder,
                error: execution.graphRun.error,
            };
        }),
        [FLOW_DESIGN_EXECUTE_IDS.reflectFlowResult]: defineFlowToolExecutor<{
            userRequest: string;
            desiredCount: number;
            wantsJson: boolean;
            sampleResult: { status: 'completed' | 'failed' | 'cancelled'; output?: unknown; logs: string[] };
        }>(async ({ userRequest, desiredCount, wantsJson, sampleResult }) => {
            const reflection = await Promise.resolve(
                provider.reflectExecution({
                    userRequest: userRequest as string,
                    desiredCount: desiredCount as number,
                    wantsJson: wantsJson as boolean,
                    sampleResult: sampleResult as {
                        status: 'completed' | 'failed' | 'cancelled';
                        output?: unknown;
                        logs: string[];
                    },
                }),
            );

            return {
                satisfied: reflection.satisfied,
                summary: reflection.summary,
                issues: reflection.issues,
                improvementNotes: reflection.suggestedImprovements,
                ...buildNodeConfigSkillImprovements({
                    userRequest: userRequest as string,
                    desiredCount: desiredCount as number,
                    wantsJson: wantsJson as boolean,
                    issues: reflection.issues,
                }),
            };
        }),
    };

    return { tools, executors };
}

/** Groups flow-design tools into a named pack for repository-level registration. */
export async function createFlowDesignToolPack(options: { provider?: FlowDesignProvider } = {}): Promise<ToolPack> {
    const resource = await loadToolPackResource('tools.flow-design.set');
    return {
        id: resource.id,
        version: resource.version,
        name: resource.name,
        description: resource.description,
        owner: resource.owner,
        scope: resource.scope,
        skills: resource.skills,
        bundle: await createFlowDesignToolBundle(options),
    };
}

/** Returns deterministic flow-designer tool metadata for callers that only need the visible tool pool. */
export async function createFlowDesignTools(
    options: { provider?: FlowDesignProvider } = {},
): Promise<ToolDefinition[]> {
    return (await createFlowDesignToolBundle(options)).tools;
}
