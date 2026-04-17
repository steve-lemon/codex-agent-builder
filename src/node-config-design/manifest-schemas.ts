// Shared schemas for the node-config design manifest surface.
import { z } from 'zod';

export const NodeConfigDefaultsSchema = z.object({
    systemPrompts: z.record(z.string()),
    aiModelProfiles: z.object({
        default: z.string(),
        'blog-title-generation': z.string(),
        'structured-output': z.string(),
    }),
});

export const NodeConfigKnowledgeConditionalNotesSchema = z.object({
    blockIds: z.array(z.string()).optional(),
    notes: z.array(z.string()).optional(),
});

export const NodeConfigKnowledgeDirectiveSchema = z.object({
    blockIds: z.array(z.string()).optional(),
    strategyId: z.string(),
    note: z.string(),
});

export const NodeConfigKnowledgeManifestSchema = z.object({
    sharedNotes: z.array(z.string()).optional(),
    conditionalSharedNotes: z.array(NodeConfigKnowledgeConditionalNotesSchema).optional(),
    strategyDirectives: z.array(NodeConfigKnowledgeDirectiveSchema).optional(),
});

export const NodeConfigDesignManifestSchema = z.object({
    defaults: NodeConfigDefaultsSchema,
    knowledge: NodeConfigKnowledgeManifestSchema,
});

export type NodeConfigDefaultsRecord = z.infer<typeof NodeConfigDefaultsSchema>;
export type NodeConfigKnowledgeConditionalNotesRecord = z.infer<typeof NodeConfigKnowledgeConditionalNotesSchema>;
export type NodeConfigKnowledgeDirectiveRecord = z.infer<typeof NodeConfigKnowledgeDirectiveSchema>;
export type NodeConfigKnowledgeManifestRecord = z.infer<typeof NodeConfigKnowledgeManifestSchema>;
export type NodeConfigDesignManifestRecord = z.infer<typeof NodeConfigDesignManifestSchema>;
