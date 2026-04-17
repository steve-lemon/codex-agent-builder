// Structured request builders for flow-design lightweight classification.
import { z } from 'zod';
import type { StructuredGenerationInput } from '../../llm/types';
import { defineStructuredSchema } from '../../llm/structured-schema';
import type { FlowDesignTaskGraphTemplate } from './task-graphs';
import type { FlowDesignTaskTypeDefinition } from './task-types';
import {
    getFlowDesignTaskGraphClassifierPrompt,
    getFlowDesignTaskTypeClassifierPrompt,
} from './classifier-resources';

const FlowDesignTaskTypeClassificationSchema = z.object({
    kind: z.literal('task-type'),
    taskType: z.string(),
    confidence: z.number().min(0).max(1).optional(),
    rationale: z.string().optional(),
});

const FlowDesignTaskGraphClassificationSchema = z.object({
    kind: z.literal('task-graph'),
    templateId: z.string(),
    confidence: z.number().min(0).max(1).optional(),
    rationale: z.string().optional(),
});

/** Builds the generic structured-generation request for task-type classification. */
export async function buildTaskTypeClassificationRequest(args: {
    userRequest: string;
    wantsJson: boolean;
    taskTypes: FlowDesignTaskTypeDefinition[];
}): Promise<StructuredGenerationInput<typeof FlowDesignTaskTypeClassificationSchema>> {
    return {
        input: [
            {
                role: 'system',
                content: await getFlowDesignTaskTypeClassifierPrompt(),
            },
            {
                role: 'user',
                content: JSON.stringify({
                    userRequest: args.userRequest,
                    wantsJson: args.wantsJson,
                    taskTypes: args.taskTypes.map(taskType => ({
                        id: taskType.id,
                        label: taskType.label,
                        description: taskType.description,
                        examples: taskType.examples,
                    })),
                }),
            },
        ],
        schema: defineStructuredSchema('flow_design_task_type_classification', FlowDesignTaskTypeClassificationSchema),
    };
}

/** Builds the generic structured-generation request for task-graph classification. */
export async function buildTaskGraphClassificationRequest(args: {
    userRequest: string;
    templates: FlowDesignTaskGraphTemplate[];
}): Promise<StructuredGenerationInput<typeof FlowDesignTaskGraphClassificationSchema>> {
    return {
        input: [
            {
                role: 'system',
                content: await getFlowDesignTaskGraphClassifierPrompt(),
            },
            {
                role: 'user',
                content: JSON.stringify({
                    userRequest: args.userRequest,
                    templates: args.templates.map(template => ({
                        id: template.id,
                        label: template.label,
                        description: template.description,
                        examples: template.examples,
                    })),
                }),
            },
        ],
        schema: defineStructuredSchema('flow_design_task_graph_classification', FlowDesignTaskGraphClassificationSchema),
    };
}
