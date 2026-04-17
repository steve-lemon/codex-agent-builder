import { z } from 'zod';

export const FlowCapabilityDefinitionSchema = z.object({
    id: z.string(),
    category: z.enum(['input', 'process', 'view', 'ai']),
    label: z.string(),
    description: z.string().optional(),
});

export const FlowConfigOptionSchema = z.object({
    value: z.string(),
    label: z.string(),
});

export const FlowNodeConfigDirectiveSchema = z.object({
    strategyId: z.string(),
    note: z.string(),
});

export const FlowBlockNodeConfigGuidanceSchema = z.object({
    sharedNotes: z.array(z.string()).optional(),
    strategyDirectives: z.array(FlowNodeConfigDirectiveSchema).optional(),
});

export const FlowBlockConfigDefinitionSchema = z.object({
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    hint: z.enum(['text', 'select', 'checkbox', 'number']),
    options: z.array(FlowConfigOptionSchema).optional(),
    required: z.boolean().optional(),
    defaultValue: z.string().optional(),
});

export const FlowBlockPortDefinitionSchema = z.object({
    localId: z.string(),
    label: z.string(),
    direction: z.enum(['input', 'output']),
    dataType: z.enum(['text', 'json', 'image', 'number', 'any']),
    description: z.string().optional(),
});

export const FlowBlockDefinitionSchema = z.object({
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    nodeConfigStrategyId: z.string().optional(),
    nodeConfigGuidance: FlowBlockNodeConfigGuidanceSchema.optional(),
    capabilities: z.array(z.string()).optional(),
    configs: z.array(FlowBlockConfigDefinitionSchema).optional(),
    inputs: z.array(FlowBlockPortDefinitionSchema),
    outputs: z.array(FlowBlockPortDefinitionSchema),
});

export const FlowBlockMatchingSchema = z.object({
    categoryPriority: z.array(z.enum(['input', 'process', 'view', 'ai'])),
    blockPriority: z.array(z.string()),
});

export const FlowBlockPoolSchema = z.object({
    version: z.number().int().positive(),
    capabilities: z.array(FlowCapabilityDefinitionSchema),
    blocks: z.array(FlowBlockDefinitionSchema),
    matching: FlowBlockMatchingSchema,
});

export type FlowBlockPoolRecord = z.infer<typeof FlowBlockPoolSchema>;
