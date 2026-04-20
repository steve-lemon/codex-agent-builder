// Task-graph inference and preflight validation tools for flow design.
import { z } from 'zod';
import { getCatalogAvailableFlowBlocks } from '../design/catalog';
import {
    analyzeTaskGraph,
    assessTaskGraphFeasibility,
    assessFlowFeasibility,
    buildProposedBlocks,
    inferTaskGraph,
    refineTaskGraph,
} from '../design/analysis';
import { createFlowAiDelegationAdvisor } from '../design/ai-delegation';
import { createFlowDesignTaskGraphAdvisor } from '../design/task-graphs';
import { normalizeFlowRequest } from '../design/core';
import { buildDesignBrief } from '../design/architecture';
import { buildToolPackFromResource, loadToolPackResource } from '../../tools/core/resources';
import {
    type ToolContext,
    type ToolDefinition,
    type ToolPack,
    type ToolRepositoryBundle,
} from '../../tools/core/types';

function defineTaskGraphToolExecutor<TArgs extends Record<string, unknown>>(
    handler: (args: TArgs, context: ToolContext) => Promise<unknown> | unknown,
) {
    return async (args: Record<string, unknown>, context: ToolContext) => {
        return await handler(args as TArgs, context);
    };
}

const TASK_GRAPH_EXECUTE_IDS = {
    inferTaskGraph: 'task-graph.infer',
    analyzeTaskGraphCompatibility: 'task-graph.analyze-compatibility',
    proposeMissingBlocks: 'task-graph.propose-missing-blocks',
    refineTaskGraph: 'task-graph.refine',
    prevalidateFlowDesignRequest: 'task-graph.prevalidate-flow-design-request',
} as const;

const TaskGraphShapeSchema = z.object({
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

function getTaskGraphToolDefinitions(): Record<
    string,
    Omit<
        ToolDefinition,
        'description' | 'riskLevel' | 'allowedSkills' | 'requiresConfirmation' | 'parallelSafe' | 'executeId'
    >
> {
    return {
        inferTaskGraph: {
            name: 'inferTaskGraph',
            parameters: z.object({ userRequest: z.string() }),
        },
        analyzeTaskGraphCompatibility: {
            name: 'analyzeTaskGraphCompatibility',
            parameters: z.object({ taskGraph: TaskGraphShapeSchema }),
        },
        proposeMissingBlocks: {
            name: 'proposeMissingBlocks',
            parameters: z.object({
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
            }),
        },
        refineTaskGraph: {
            name: 'refineTaskGraph',
            parameters: z.object({
                taskGraph: TaskGraphShapeSchema,
                reflection: z.object({
                    issues: z.array(z.string()).default([]),
                    improvementNotes: z.array(z.string()).default([]),
                    triggeredRuleIds: z.array(z.string()).optional(),
                }),
            }),
        },
        prevalidateFlowDesignRequest: {
            name: 'prevalidateFlowDesignRequest',
            parameters: z.object({
                userRequest: z.string(),
                taskGraph: TaskGraphShapeSchema.optional(),
            }),
        },
    };
}

function getTaskGraphToolExecutors() {
    return {
        [TASK_GRAPH_EXECUTE_IDS.inferTaskGraph]: defineTaskGraphToolExecutor<{ userRequest: string }>(
            async ({ userRequest }, context) => {
                const normalizedRequest = await normalizeFlowRequest(userRequest);
                const designBrief = await buildDesignBrief(normalizedRequest);
                return {
                    taskGraph: await inferTaskGraph(userRequest, {
                        taskGraphAdvisor: createFlowDesignTaskGraphAdvisor(context.llm),
                        taskType: normalizedRequest.taskType,
                        operationModel: designBrief.mission.operationModel,
                        semanticFacets: designBrief.semanticFacets,
                    }),
                };
            },
        ),
        [TASK_GRAPH_EXECUTE_IDS.analyzeTaskGraphCompatibility]: defineTaskGraphToolExecutor<{
            taskGraph: {
                nodes: Array<{ id: string; label?: string; data?: Record<string, unknown> }>;
                edges: Array<{ source: string; target: string; label?: string; data?: Record<string, unknown> }>;
            };
        }>(async ({ taskGraph }, context) => ({
            availableBlocks: (await getCatalogAvailableFlowBlocks()).map(block => ({
                id: block.id,
                label: block.label,
            })),
            nodeAnalyses: await analyzeTaskGraph(taskGraph, {
                userRequest: '',
                aiDelegationAdvisor: createFlowAiDelegationAdvisor(context.llm),
            }),
        })),
        [TASK_GRAPH_EXECUTE_IDS.proposeMissingBlocks]: defineTaskGraphToolExecutor<{
            nodeAnalyses: Array<{
                nodeId: string;
                operation: string;
                expectedInputs: string[];
                expectedOutputs: string[];
                requiredCapabilities: string[];
                matchedBlockIds: string[];
                feasible: boolean;
                reasons: string[];
            }>;
        }>(async ({ nodeAnalyses }) => ({
            proposedBlocks: buildProposedBlocks(nodeAnalyses),
        })),
        [TASK_GRAPH_EXECUTE_IDS.refineTaskGraph]: defineTaskGraphToolExecutor<{
            taskGraph: {
                nodes: Array<{ id: string; label?: string; data?: Record<string, unknown> }>;
                edges: Array<{ source: string; target: string; label?: string; data?: Record<string, unknown> }>;
            };
            reflection: { issues: string[]; improvementNotes: string[]; triggeredRuleIds?: string[] };
        }>(async ({ taskGraph, reflection }) => {
            const refinedTaskGraph = await refineTaskGraph(taskGraph, reflection);
            return {
                taskGraph: refinedTaskGraph,
                changeSummary: reflection.improvementNotes,
            };
        }),
        [TASK_GRAPH_EXECUTE_IDS.prevalidateFlowDesignRequest]: defineTaskGraphToolExecutor<{
            userRequest: string;
            taskGraph?: {
                nodes: Array<{ id: string; label?: string; data?: Record<string, unknown> }>;
                edges: Array<{ source: string; target: string; label?: string; data?: Record<string, unknown> }>;
            };
        }>(async ({ userRequest, taskGraph }, context) =>
            taskGraph
                ? await assessTaskGraphFeasibility(userRequest, taskGraph, {
                      aiDelegationAdvisor: createFlowAiDelegationAdvisor(context.llm),
                      taskGraphAdvisor: createFlowDesignTaskGraphAdvisor(context.llm),
                  })
                : await (async () => {
                      const normalizedRequest = await normalizeFlowRequest(userRequest);
                      const designBrief = await buildDesignBrief(normalizedRequest);
                      return await assessFlowFeasibility(userRequest, {
                          aiDelegationAdvisor: createFlowAiDelegationAdvisor(context.llm),
                          taskGraphAdvisor: createFlowDesignTaskGraphAdvisor(context.llm),
                          taskType: normalizedRequest.taskType,
                          operationModel: designBrief.mission.operationModel,
                          semanticFacets: designBrief.semanticFacets,
                      });
                  })(),
        ),
    };
}

/** Returns deterministic task-graph tool metadata plus executor mappings. */
export async function createTaskGraphToolBundle(): Promise<ToolRepositoryBundle> {
    return (await createTaskGraphToolPack()).bundle;
}

/** Groups task-graph analysis tools into a named pack for repository-level registration. */
export async function createTaskGraphToolPack(): Promise<ToolPack> {
    const resource = await loadToolPackResource('tools.task-graph.set');
    const pack = buildToolPackFromResource(resource, getTaskGraphToolDefinitions());
    return {
        ...pack,
        bundle: {
            tools: pack.bundle.tools,
            executors: getTaskGraphToolExecutors(),
        },
    };
}

/** Returns deterministic task-graph tool metadata for callers that only need the visible tool pool. */
export async function createTaskGraphTools(): Promise<ToolDefinition[]> {
    return (await createTaskGraphToolBundle()).tools;
}
