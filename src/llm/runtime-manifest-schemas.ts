// Shared schemas for the aggregated runtime LLM manifest surface.
import { z } from 'zod';

export const DefaultToolPackIdsSchema = z.array(z.string());

export const StructuredTaskPromptsSchema = z.object({
    planSystemPrompt: z.string(),
    reflectSystemPrompt: z.string(),
    finalizeSystemPrompt: z.string(),
});

export const FakeCopySchema = z.object({
    plan: z.object({
        research: z.object({
            collectFactsDescription: z.string(),
            synthesizeDescription: z.string(),
            synthesizeReasoning: z.string(),
            finalizeDescription: z.string(),
        }),
        ops: z.object({
            readContextDescription: z.string(),
            notifyDescription: z.string(),
            statusQuery: z.string(),
            slackMessage: z.string(),
            finalizeDescription: z.string(),
        }),
        flowPreflight: z.object({
            inferTaskGraphDescription: z.string(),
            analyzeCompatibilityDescription: z.string(),
            proposeMissingBlocksDescription: z.string(),
            prevalidateDescription: z.string(),
            finalizeDescription: z.string(),
        }),
        nodeConfig: z.object({
            reasoningDescription: z.string(),
            reasoning: z.string(),
            finalizeDescription: z.string(),
        }),
        flowDesigner: z.object({
            analyzeIntentDescription: z.string(),
            prevalidateDescription: z.string(),
            infeasibleStopDescription: z.string(),
            infeasibleStopReasoning: z.string(),
            infeasibleFinalizeDescription: z.string(),
            probeDescription: z.string(),
            finalizeDescription: z.string(),
        }),
        customerSupport: z.object({
            loadContextDescription: z.string(),
            evaluateActionDescription: z.string(),
            evaluateActionReasoning: z.string(),
            approvalActionDescription: z.string(),
            escalationReason: z.string(),
            finalizeDescription: z.string(),
        }),
    }),
    final: z.object({
        nodeConfigDesigner: z.object({
            summary: z.string(),
            nextActions: z.array(z.string()),
            improvements: z.array(z.string()),
        }),
        generic: z.object({
            reviewTraceLogs: z.string(),
        }),
    }),
});

export const LlmRuntimeManifestSchema = z.object({
    defaultToolPackIds: DefaultToolPackIdsSchema,
    structuredTaskPrompts: StructuredTaskPromptsSchema,
    fakeCopy: FakeCopySchema,
});

export type DefaultToolPackIdsRecord = z.infer<typeof DefaultToolPackIdsSchema>;
export type StructuredTaskPromptsRecord = z.infer<typeof StructuredTaskPromptsSchema>;
export type FakeCopyRecord = z.infer<typeof FakeCopySchema>;
export type LlmRuntimeManifestRecord = z.infer<typeof LlmRuntimeManifestSchema>;
