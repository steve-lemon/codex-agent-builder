// Shared deterministic copy used by fake LLM planners and formatters.
import { join } from 'node:path';
import { z } from 'zod';
import { CachedJsonFileResource } from '../resources/json-file';
import { resolveJsonResourcePath } from '../resources/path-resolver';

const FakeCopySchema = z.object({
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

const fakeCopyResource = new CachedJsonFileResource(
    resolveJsonResourcePath({
        fallbackRoot: join(process.cwd(), 'data'),
        relativePath: join('runtime', 'FAKE_LLM_COPY.json'),
    }),
    FakeCopySchema,
);

/** Returns deterministic fake planner copy from the shared async-backed resource layer. */
export async function getFakePlanCopy() {
    return (await fakeCopyResource.load()).plan;
}

/** Returns deterministic fake finalizer copy from the shared async-backed resource layer. */
export async function getFakeFinalCopy() {
    return (await fakeCopyResource.load()).final;
}
