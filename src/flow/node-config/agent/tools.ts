// Tools that expose the node-configuration design sub-agent to the runtime.
import { z } from 'zod';
import { NodeConfigDesignService } from '../design/core';
import { buildToolPackFromResource, loadToolPackResource } from '../../../tools/core/resources';
import { type ToolContext, type ToolDefinition, type ToolPack, type ToolRepositoryBundle } from '../../../tools/core/types';

const service = new NodeConfigDesignService();

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

const FlowDocumentSchema = z.object({
    blocks: z.array(
        z.object({
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
        }),
    ),
    nodes: z.array(FlowNodeSchema),
    edges: z.array(FlowEdgeSchema),
});

const ProbeResultSchema = z.object({
    blockId: z.string(),
    observedOutputs: z.record(z.unknown()).optional(),
    observedLogs: z.array(z.string()).optional(),
    behaviorNotes: z.array(z.string()).optional(),
    mismatchesFromSpec: z.array(z.string()).optional(),
});

const StrategyDirectiveSchema = z.object({
    strategyId: z.string(),
    note: z.string(),
});

function defineNodeConfigToolExecutor<TArgs extends Record<string, unknown>>(
    handler: (args: TArgs, context: ToolContext) => Promise<unknown> | unknown,
) {
    return async (args: Record<string, unknown>, context: ToolContext) => {
        return await handler(args as TArgs, context);
    };
}

const NODE_CONFIG_EXECUTE_IDS = {
    designFlowNodeConfigurations: 'node-config.design-flow-node-configurations',
    validateFlowNodeConfigurations: 'node-config.validate-flow-node-configurations',
} as const;

function getNodeConfigToolDefinitions(): Record<
    string,
    Omit<
        ToolDefinition,
        'description' | 'riskLevel' | 'allowedSkills' | 'requiresConfirmation' | 'parallelSafe' | 'executeId'
    >
> {
    return {
        designFlowNodeConfigurations: {
            name: 'designFlowNodeConfigurations',
            parameters: z.object({
                userRequest: z.string(),
                flow: FlowDocumentSchema,
                desiredCount: z.number().int().positive(),
                wantsJson: z.boolean(),
                improvementNotes: z.array(z.string()).optional(),
                strategyNotes: z.array(z.string()).optional(),
                strategyDirectives: z.array(StrategyDirectiveSchema).optional(),
                probeResult: ProbeResultSchema.optional(),
            }),
        },
        validateFlowNodeConfigurations: {
            name: 'validateFlowNodeConfigurations',
            parameters: z.object({
                flow: FlowDocumentSchema,
            }),
        },
    };
}

function getNodeConfigToolExecutors() {
    return {
        [NODE_CONFIG_EXECUTE_IDS.designFlowNodeConfigurations]: defineNodeConfigToolExecutor<{
            userRequest: string;
            flow: unknown;
            desiredCount: number;
            wantsJson: boolean;
            improvementNotes?: string[];
            strategyNotes?: string[];
            strategyDirectives?: Array<{ strategyId: string; note: string }>;
            probeResult?: {
                blockId: string;
                observedOutputs?: Record<string, unknown>;
                observedLogs?: string[];
                behaviorNotes?: string[];
                mismatchesFromSpec?: string[];
            };
        }>(
            async ({
                userRequest,
                flow,
                desiredCount,
                wantsJson,
                improvementNotes = [],
                strategyNotes = [],
                strategyDirectives = [],
                probeResult,
            }) =>
                service.design({
                    userRequest,
                    flow: flow as never,
                    desiredCount,
                    wantsJson,
                    improvementNotes,
                    strategyNotes,
                    strategyDirectives,
                    probeResult,
                }),
        ),
        [NODE_CONFIG_EXECUTE_IDS.validateFlowNodeConfigurations]: defineNodeConfigToolExecutor<{ flow: unknown }>(
            async ({ flow }) => service.validate(flow as never),
        ),
    };
}

/** Returns node-config tool metadata plus executor mappings for repository-style registration. */
export async function createNodeConfigToolBundle(): Promise<ToolRepositoryBundle> {
    return (await createNodeConfigToolPack()).bundle;
}

/** Groups node-config design tools into a named pack for repository-level registration. */
export async function createNodeConfigToolPack(): Promise<ToolPack> {
    const resource = await loadToolPackResource('tools.node-config.set');
    const pack = buildToolPackFromResource(resource, getNodeConfigToolDefinitions());
    return {
        ...pack,
        bundle: {
            tools: pack.bundle.tools,
            executors: getNodeConfigToolExecutors(),
        },
    };
}

/** Returns node-config tool metadata for callers that only need the visible tool pool. */
export async function createNodeConfigTools(): Promise<ToolDefinition[]> {
    return (await createNodeConfigToolBundle()).tools;
}
