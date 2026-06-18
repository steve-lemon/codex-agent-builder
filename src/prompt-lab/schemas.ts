import { z } from 'zod';

export const PromptLabSelfReviewSchema = z.object({
    summary: z.string().min(1),
    strengths: z.array(z.string()).min(1),
    weaknesses: z.array(z.string()).min(1),
    improvements: z.array(z.string()).min(1),
    recommendedPromptFocus: z.array(z.string()).min(1),
});

export const PromptLabCodexPromptSchema = z.object({
    title: z.string().min(1),
    summary: z.string().min(1),
    codexPrompt: z.string().min(1),
    usageNotes: z.array(z.string()).min(1),
});
