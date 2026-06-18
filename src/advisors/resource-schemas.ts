import { z } from 'zod';

export const LiteAdvisorDefinitionSchema = z.object({
    id: z.string(),
    label: z.string().optional(),
    description: z.string().optional(),
    systemPrompt: z.string(),
    fallbackNote: z.string().optional(),
    confidenceThreshold: z.number().min(0).max(1).optional(),
    includeRationale: z.boolean().optional(),
    candidateLimit: z.number().int().positive().optional(),
});

export const LiteAdvisorResourceSchema = z.object({
    version: z.number().int().positive(),
    advisors: z.array(LiteAdvisorDefinitionSchema),
});

export const LiteAdvisorEvaluationScenarioSchema = z.object({
    id: z.string(),
    label: z.string().optional(),
    input: z.record(z.unknown()),
    expected: z.record(z.unknown()),
    notes: z.string().optional(),
});

export const LiteAdvisorEvaluationSuiteSchema = z.object({
    advisorId: z.string(),
    label: z.string().optional(),
    description: z.string().optional(),
    acceptance: z
        .object({
            minPassRate: z.number().min(0).max(1).optional(),
            maxFallbackRate: z.number().min(0).max(1).optional(),
            maxAverageLatencyMs: z.number().positive().optional(),
            maxP95LatencyMs: z.number().positive().optional(),
        })
        .optional(),
    scenarios: z.array(LiteAdvisorEvaluationScenarioSchema).min(1),
});

export const LiteAdvisorEvaluationResourceSchema = z.object({
    version: z.number().int().positive(),
    suites: z.array(LiteAdvisorEvaluationSuiteSchema).min(1),
});

export type LiteAdvisorDefinitionRecord = z.infer<typeof LiteAdvisorDefinitionSchema>;
export type LiteAdvisorResourceRecord = z.infer<typeof LiteAdvisorResourceSchema>;
export type LiteAdvisorEvaluationScenarioRecord = z.infer<typeof LiteAdvisorEvaluationScenarioSchema>;
export type LiteAdvisorEvaluationSuiteRecord = z.infer<typeof LiteAdvisorEvaluationSuiteSchema>;
export type LiteAdvisorEvaluationResourceRecord = z.infer<typeof LiteAdvisorEvaluationResourceSchema>;
