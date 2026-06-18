// Shared schemas for the flow-design manifest surface.
import { z } from 'zod';

export const FlowDesignTaskTypeDefinitionSchema = z.object({
    id: z.string(),
    label: z.string(),
    description: z.string(),
    examples: z.array(z.string()),
    signals: z.array(z.string()),
    hints: z
        .object({
            preferredWhenJson: z.boolean().optional(),
            fallbackWhenPlainText: z.boolean().optional(),
        })
        .optional(),
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
    taskTypes: z.array(z.string()).optional(),
    operationModels: z.array(z.string()).optional(),
    traits: z.array(z.string()).optional(),
    graph: z.object({
        nodes: z.array(TaskGraphNodeSchema),
        edges: z.array(TaskGraphEdgeSchema),
    }),
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
    taskTypeSelection: z.object({
        jsonPreferredTaskTypeId: z.string(),
        plainTextFallbackTaskTypeId: z.string(),
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

export const FlowDesignReflectionRuleSchema = z.object({
    id: z.string(),
    match: z.object({
        taskTypes: z.array(z.string()).optional(),
        maxItemLength: z.number().int().positive().optional(),
    }),
    issue: z.string(),
    suggestedImprovement: z.string(),
    taskGraphRefinement: z
        .object({
            targetOperationPrefixes: z.array(z.string()).optional(),
            expectedOutputs: z.array(z.string()).optional(),
            requiredCapabilities: z.array(z.string()).optional(),
            qualityHints: z.array(z.string()).optional(),
        })
        .optional(),
});

export const FlowDesignKnowledgeManifestSchema = z.object({
    sharedDraftNotes: z.array(z.string()).optional(),
    conditionalDraftNotes: z.array(FlowDesignKnowledgeConditionalNotesSchema).optional(),
    reflectionNotes: z.array(z.string()).optional(),
    reflectionRules: z.array(FlowDesignReflectionRuleSchema).optional(),
});

export const FlowDesignManifestSchema = z.object({
    taskTypes: z.array(FlowDesignTaskTypeDefinitionSchema),
    taskGraphTemplates: z.array(TaskGraphTemplateSchema),
    classifierPrompts: FlowDesignClassifierPromptsSchema,
    defaults: FlowDesignDefaultsSchema,
    knowledge: FlowDesignKnowledgeManifestSchema,
});

export type FlowDesignTaskTypeDefinitionRecord = z.infer<typeof FlowDesignTaskTypeDefinitionSchema>;
export type FlowDesignTaskGraphTemplateRecord = z.infer<typeof TaskGraphTemplateSchema>;
export type FlowDesignClassifierPromptsRecord = z.infer<typeof FlowDesignClassifierPromptsSchema>;
export type FlowDesignDefaultsRecord = z.infer<typeof FlowDesignDefaultsSchema>;
export type FlowDesignKnowledgeConditionalNotesRecord = z.infer<typeof FlowDesignKnowledgeConditionalNotesSchema>;
export type FlowDesignReflectionRuleRecord = z.infer<typeof FlowDesignReflectionRuleSchema>;
export type FlowDesignKnowledgeManifestRecord = z.infer<typeof FlowDesignKnowledgeManifestSchema>;
export type FlowDesignManifestRecord = z.infer<typeof FlowDesignManifestSchema>;
