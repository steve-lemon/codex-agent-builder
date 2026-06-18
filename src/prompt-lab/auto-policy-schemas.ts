import { z } from 'zod';

const PromptLabAutoSignalSchema = z.object({
    runStatuses: z.array(z.enum(['idle', 'running', 'waiting_for_approval', 'completed', 'failed'])).default([]),
    fulfillmentLevels: z.array(z.enum(['fulfilled', 'uncertain', 'partial', 'not-fulfilled'])).default([]),
    reasonCodes: z
        .array(
            z.enum([
                'execution-failed',
                'execution-completed-without-solution',
                'missing-capabilities',
                'generic-task-graph-fallback',
                'mock-model-config',
                'json-contract-not-preserved',
                'json-schema-missing',
                'plain-text-format-drift',
                'synthetic-sample-validation',
            ]),
        )
        .default([]),
    synthesizedDesignSnapshot: z.boolean().default(false),
});

export const PromptLabAutoPolicySchema = z.object({
    version: z.number().int().positive(),
    auto: z.object({
        stop: PromptLabAutoSignalSchema,
        warn: PromptLabAutoSignalSchema,
    }),
});

export type PromptLabAutoPolicyRecord = z.output<typeof PromptLabAutoPolicySchema>;
