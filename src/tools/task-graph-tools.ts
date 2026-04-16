// Task-graph inference and preflight validation tools for flow design.
import { z } from 'zod';
import { defineTool, type ToolDefinition } from './types';
import { availableFlowBlocks } from '../flow-design/catalog';
import {
    analyzeTaskGraph,
    assessTaskGraphFeasibility,
    assessFlowFeasibility,
    buildProposedBlocks,
    inferTaskGraph,
    refineTaskGraph,
} from '../flow-design/analysis';

/** Returns deterministic tools used by the flow-preflight-validator skill. */
export function createTaskGraphTools(): ToolDefinition[] {
    return [
        defineTool({
            name: 'inferTaskGraph',
            description:
                'Infer the user request as a task graph with ordered operations, expected IO, and dependencies.',
            parameters: z.object({
                userRequest: z.string(),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-preflight-validator'],
            requiresConfirmation: false,
            parallelSafe: true,
            execute: async ({ userRequest }) => {
                return {
                    taskGraph: inferTaskGraph(userRequest),
                };
            },
        }),
        defineTool({
            name: 'analyzeTaskGraphCompatibility',
            description:
                'Match each inferred task-graph node to currently available blocks and explain why a node is or is not feasible.',
            parameters: z.object({
                taskGraph: z.object({
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
                }),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-preflight-validator'],
            requiresConfirmation: false,
            parallelSafe: true,
            execute: async ({ taskGraph }) => {
                return {
                    availableBlocks: availableFlowBlocks.map(block => ({
                        id: block.id,
                        label: block.label,
                    })),
                    nodeAnalyses: analyzeTaskGraph(taskGraph),
                };
            },
        }),
        defineTool({
            name: 'proposeMissingBlocks',
            description:
                'Draft new block proposals for infeasible task-graph nodes that do not match the current block set.',
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
            riskLevel: 'read-only',
            allowedSkills: ['flow-preflight-validator'],
            requiresConfirmation: false,
            parallelSafe: true,
            execute: async ({ nodeAnalyses }) => {
                return {
                    proposedBlocks: buildProposedBlocks(nodeAnalyses),
                };
            },
        }),
        defineTool({
            name: 'refineTaskGraph',
            description:
                'Refine an inferred task graph using reflection issues and improvement notes from an earlier design pass.',
            parameters: z.object({
                taskGraph: z.object({
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
                }),
                reflection: z.object({
                    issues: z.array(z.string()).default([]),
                    improvementNotes: z.array(z.string()).default([]),
                }),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-preflight-validator', 'flow-designer'],
            requiresConfirmation: false,
            parallelSafe: true,
            execute: async ({ taskGraph, reflection }) => {
                // TODO(flow-agent): Emit structured diff data here so UI layers
                // can visualize exactly how the inferred graph changed per pass.
                const refinedTaskGraph = refineTaskGraph(taskGraph, reflection);
                return {
                    taskGraph: refinedTaskGraph,
                    changeSummary: reflection.improvementNotes,
                };
            },
        }),
        defineTool({
            name: 'prevalidateFlowDesignRequest',
            description:
                'Run full graph-based preflight validation for a flow design request and summarize feasibility, graph reasoning, and missing blocks.',
            parameters: z.object({
                userRequest: z.string(),
                taskGraph: z
                    .object({
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
                    })
                    .optional(),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-preflight-validator', 'flow-designer'],
            requiresConfirmation: false,
            parallelSafe: true,
            execute: async ({ userRequest, taskGraph }) => {
                // TODO(flow-agent): Cache repeated preflight results per request
                // and task-graph hash once real providers make this path costlier.
                return taskGraph
                    ? assessTaskGraphFeasibility(userRequest, taskGraph)
                    : assessFlowFeasibility(userRequest);
            },
        }),
    ];
}
