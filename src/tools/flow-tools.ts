// Flow-design tool wrappers built on the shared flow-design core.
import { z } from 'zod';
import {
    analyzeFlowRequest,
    designFlowDraft,
    executeFlowDesignSample,
    probeFlowBlockRuntime,
    proposeBlockSpecUpdate,
    reflectFlowExecution,
    validateDesignedFlow,
} from '../flow-design/core';
import { availableFlowBlocks } from '../flow-design/catalog';
import type { FlowDocument } from '../flow/types';
import { defineTool, type ToolDefinition } from './types';
import type { FlowFeasibilityAssessment } from '../flow-design/analysis';
import { assessFlowFeasibility } from '../flow-design/analysis';

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

function hydrateFlowDocument(flow: FlowDocument): FlowDocument {
    return {
        ...flow,
        blocks: flow.blocks.length > 0 ? flow.blocks : availableFlowBlocks,
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

/** Returns deterministic tools used by the flow-designer skill. */
export function createFlowDesignTools(): ToolDefinition[] {
    return [
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
            execute: async ({ userRequest }) => {
                const intent = analyzeFlowRequest(userRequest);
                return {
                    taskType: intent.taskType,
                    wantsJson: intent.wantsJson,
                    wantsMultiple: intent.wantsMultiple,
                    desiredCount: intent.desiredCount,
                    sampleInput: intent.sampleInput,
                    constraints: ['Use only available blocks from the repository.'],
                    successCriteria:
                        intent.desiredCount > 1
                            ? [`Produce ${intent.desiredCount} useful outputs.`]
                            : ['Produce one useful output.'],
                };
            },
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
            execute: async ({ includeIds }) => {
                const ids = includeIds ? new Set(includeIds) : undefined;
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
            execute: async ({ userRequest }) => {
                return assessFlowFeasibility(userRequest);
            },
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
            execute: async ({ blockId, sampleConfig, sampleInputs }) => {
                return await probeFlowBlockRuntime({
                    blockId,
                    sampleConfig,
                    sampleInputs,
                    availableBlocks: availableFlowBlocks,
                });
            },
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
            execute: async (
                { userRequest, sampleInput, desiredCount, wantsJson, improvementNotes = [], preflight },
                context,
            ) => {
                const feasibility =
                    (preflight as FlowFeasibilityAssessment | undefined) ?? assessFlowFeasibility(userRequest);
                return designFlowDraft({
                    userRequest,
                    sampleInput,
                    desiredCount,
                    wantsJson,
                    improvementNotes,
                    preflight: feasibility,
                    availableBlocks: availableFlowBlocks,
                    designConnection: context.designConnection,
                    designSessionId: `${context.runId}:designFlowDraft`,
                    toolName: 'designFlowDraft',
                });
            },
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
            execute: async ({ flow }) => {
                const validation = validateDesignedFlow(hydrateFlowDocument(flow));
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
            execute: async ({ blockId, probeResult }) => {
                return proposeBlockSpecUpdate({
                    blockId,
                    probeResult,
                    availableBlocks: availableFlowBlocks,
                });
            },
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
            execute: async ({ userRequest, flow, improvementNotes = [] }) => {
                const execution = await executeFlowDesignSample({
                    flow: hydrateFlowDocument(flow),
                    userRequest,
                    improvementNotes,
                });

                return {
                    status: execution.status,
                    output: execution.output,
                    logs: execution.logs,
                    executionOrder: execution.graphRun.executionOrder,
                    error: execution.graphRun.error,
                };
            },
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
            execute: async ({ userRequest, desiredCount, wantsJson, sampleResult }) => {
                const reflection = reflectFlowExecution({
                    userRequest,
                    desiredCount,
                    wantsJson,
                    sampleResult,
                });

                return {
                    satisfied: reflection.satisfied,
                    summary: reflection.summary,
                    issues: reflection.issues,
                    improvementNotes: reflection.suggestedImprovements,
                    ...buildNodeConfigSkillImprovements({
                        userRequest,
                        desiredCount,
                        wantsJson,
                        issues: reflection.issues,
                    }),
                };
            },
        }),
    ];
}
