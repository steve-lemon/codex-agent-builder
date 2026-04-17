// Shared schemas for the flow-design manifest surface.
import { z } from 'zod';

export const FlowDesignTaskTypeDefinitionSchema = z.object({
    id: z.enum(['blog-title-generation', 'json-generation', 'text-generation']),
    label: z.string(),
    description: z.string(),
    examples: z.array(z.string()),
    signals: z.array(z.string()),
});

export const FlowDesignTaskTypeCatalogSchema = z.object({
    taskTypes: z.array(FlowDesignTaskTypeDefinitionSchema),
});

export const TaskGraphNodeSchema = z.object({
    id: z.string(),
    label: z.string().optional(),
    data: z.record(z.unknown()).optional(),
});

export const TaskGraphEdgeSchema = z.object({
    source: z.string(),
    target: z.string(),
    label: z.string().optional(),
    data: z.record(z.unknown()).optional(),
});

export const TaskGraphTemplateSchema = z.object({
    id: z.string(),
    label: z.string(),
    description: z.string(),
    examples: z.array(z.string()),
    signals: z.array(z.string()),
    graph: z.object({
        nodes: z.array(TaskGraphNodeSchema),
        edges: z.array(TaskGraphEdgeSchema),
    }),
});

export const TaskGraphCatalogSchema = z.object({
    templates: z.array(TaskGraphTemplateSchema),
});

export const FlowDesignClassifierPromptsSchema = z.object({
    taskTypeSystemPrompt: z.string(),
    taskGraphSystemPrompt: z.string(),
});

export const FlowDesignDefaultsSchema = z.object({
    sampleInputs: z.object({
        default: z.string(),
        keywordDriven: z.string(),
        byTaskType: z.record(z.string()),
    }),
    systemPrompts: z.record(z.string()),
    aiNodeDefaults: z.object({
        model: z.string(),
    }),
    probeDefaults: z.object({
        sampleConfig: z.object({
            model: z.string(),
        }),
        sampleInputs: z.object({
            system: z.string(),
            prompt: z.string(),
        }),
    }),
});

export const FlowDesignKnowledgeConditionalNotesSchema = z.object({
    match: z
        .object({
            taskTypes: z.array(z.string()).optional(),
            wantsJson: z.boolean().optional(),
            wantsMultiple: z.boolean().optional(),
        })
        .optional(),
    notes: z.array(z.string()).optional(),
});

export const FlowDesignKnowledgeManifestSchema = z.object({
    sharedDraftNotes: z.array(z.string()).optional(),
    conditionalDraftNotes: z.array(FlowDesignKnowledgeConditionalNotesSchema).optional(),
    reflectionNotes: z.array(z.string()).optional(),
});

export type FlowDesignTaskTypeDefinitionRecord = z.infer<typeof FlowDesignTaskTypeDefinitionSchema>;
export type FlowDesignTaskTypeCatalogRecord = z.infer<typeof FlowDesignTaskTypeCatalogSchema>;
export type FlowDesignTaskGraphTemplateRecord = z.infer<typeof TaskGraphTemplateSchema>;
export type FlowDesignTaskGraphCatalogRecord = z.infer<typeof TaskGraphCatalogSchema>;
export type FlowDesignClassifierPromptsRecord = z.infer<typeof FlowDesignClassifierPromptsSchema>;
export type FlowDesignDefaultsRecord = z.infer<typeof FlowDesignDefaultsSchema>;
export type FlowDesignKnowledgeConditionalNotesRecord = z.infer<typeof FlowDesignKnowledgeConditionalNotesSchema>;
export type FlowDesignKnowledgeManifestRecord = z.infer<typeof FlowDesignKnowledgeManifestSchema>;
