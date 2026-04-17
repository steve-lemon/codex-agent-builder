import { z } from 'zod';

const PromptLabLanguageCopySchema = z.object({
    locale: z.string().min(2),
    displayName: z.string().min(1),
    welcome: z.string().min(1),
    providerPrompt: z.string().min(1),
    skillPrompt: z.string().min(1),
    mainModelPrompt: z.string().min(1),
    liteModelPrompt: z.string().min(1),
    languagePrompt: z.string().min(1),
    requirementPrompt: z.string().min(1),
    feedbackPrompt: z.string().min(1),
    feedbackDoneHint: z.string().min(1),
    startMessage: z.string().min(1),
    selfReviewMessage: z.string().min(1),
    finalPromptMessage: z.string().min(1),
    completionMessage: z.string().min(1),
});

export const PromptLabManifestSchema = z.object({
    version: z.number().int().positive(),
    defaults: z.object({
        language: z.string().min(2),
        skillName: z.enum(['flow-preflight-validator', 'flow-designer', 'node-config-designer']),
        outputRoot: z.string().min(1),
        providerOrder: z.array(z.enum(['openai', 'gemini', 'fake'])).min(1),
        skillOrder: z.array(z.enum(['flow-preflight-validator', 'flow-designer', 'node-config-designer'])).min(1),
    }),
    cli: z.object({
        languages: z.record(PromptLabLanguageCopySchema),
    }),
    selfReview: z.object({
        systemPrompt: z.string().min(1),
    }),
    codexPrompt: z.object({
        systemPrompt: z.string().min(1),
    }),
});

export type PromptLabManifestRecord = z.infer<typeof PromptLabManifestSchema>;
export type PromptLabLanguageCopy = z.infer<typeof PromptLabLanguageCopySchema>;
