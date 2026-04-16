// Tools that expose the node-configuration design sub-agent to the runtime.
import { z } from 'zod';
import { NodeConfigDesignAgent } from '../node-config-agent/agent';
import { defineTool, type ToolDefinition } from './types';

const agent = new NodeConfigDesignAgent();

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

/** Returns tools that design and validate concrete node configurations for a flow draft. */
export function createNodeConfigTools(): ToolDefinition[] {
    return [
        defineTool({
            name: 'designFlowNodeConfigurations',
            description:
                'Design concrete configuration values for flow nodes so each block has the settings and prompts it needs to behave as expected.',
            parameters: z.object({
                userRequest: z.string(),
                flow: FlowDocumentSchema,
                desiredCount: z.number().int().positive(),
                wantsJson: z.boolean(),
                improvementNotes: z.array(z.string()).optional(),
                strategyNotes: z.array(z.string()).optional(),
                probeResult: ProbeResultSchema.optional(),
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer', 'node-config-designer'],
            requiresConfirmation: false,
            parallelSafe: false,
            execute: async ({
                userRequest,
                flow,
                desiredCount,
                wantsJson,
                improvementNotes = [],
                strategyNotes = [],
                probeResult,
            }) => {
                return agent.design({
                    userRequest,
                    flow,
                    desiredCount,
                    wantsJson,
                    improvementNotes,
                    strategyNotes,
                    probeResult,
                });
            },
        }),
        defineTool({
            name: 'validateFlowNodeConfigurations',
            description: 'Validate that a flow draft now contains the required node-level settings for execution.',
            parameters: z.object({
                flow: FlowDocumentSchema,
            }),
            riskLevel: 'read-only',
            allowedSkills: ['flow-designer', 'node-config-designer'],
            requiresConfirmation: false,
            parallelSafe: true,
            execute: async ({ flow }) => {
                return agent.validate(flow);
            },
        }),
    ];
}
