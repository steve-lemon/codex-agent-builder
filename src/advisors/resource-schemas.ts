import { z } from 'zod';

export const LiteAdvisorDefinitionSchema = z.object({
    id: z.string(),
    label: z.string().optional(),
    description: z.string().optional(),
    systemPrompt: z.string(),
    fallbackNote: z.string().optional(),
    confidenceThreshold: z.number().min(0).max(1).optional(),
});

export const LiteAdvisorResourceSchema = z.object({
    version: z.number().int().positive(),
    advisors: z.array(LiteAdvisorDefinitionSchema),
});

export type LiteAdvisorDefinitionRecord = z.infer<typeof LiteAdvisorDefinitionSchema>;
export type LiteAdvisorResourceRecord = z.infer<typeof LiteAdvisorResourceSchema>;
