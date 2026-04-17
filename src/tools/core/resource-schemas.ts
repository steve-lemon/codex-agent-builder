import { z } from 'zod';

export const ToolSpecResourceSchema = z.object({
    name: z.string(),
    description: z.string(),
    riskLevel: z.enum(['read-only', 'side-effecting', 'approval-required']),
    allowedSkills: z.array(z.string()),
    requiresConfirmation: z.boolean(),
    parallelSafe: z.boolean(),
    executeId: z.string().optional(),
});

export const ToolPackResourceSchema = z.object({
    id: z.string(),
    version: z.number().int().positive(),
    name: z.string(),
    description: z.string(),
    owner: z.string(),
    scope: z.enum(['agent-owned', 'sample-only', 'shared']),
    skills: z.array(z.string()),
    tools: z.array(ToolSpecResourceSchema),
});

export type ToolSpecResourceRecord = z.infer<typeof ToolSpecResourceSchema>;
export type ToolPackResourceRecord = z.infer<typeof ToolPackResourceSchema>;
