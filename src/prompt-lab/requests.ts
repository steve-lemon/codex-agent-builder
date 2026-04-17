import type { StructuredGenerationInput } from '../llm/types';
import { defineStructuredSchema } from '../llm/structured-schema';
import type { ProductDesignRunResult } from '../product/types';
import { getPromptLabManifest } from './manifest';
import { PromptLabCodexPromptSchema, PromptLabSelfReviewSchema } from './schemas';
import type { PromptLabLanguage, PromptLabSelfReview, PromptLabSessionRecord } from './types';

function buildRunSnapshot(session: PromptLabSessionRecord, result: ProductDesignRunResult) {
    return {
        sessionId: session.sessionId,
        requirement: session.requirement,
        language: session.config.language,
        provider: session.config.provider,
        mainModel: session.config.mainModel,
        liteModel: session.config.liteModel,
        skillName: result.skillName,
        status: result.status,
        summary: result.summary,
        success: result.success,
        nextActions: result.nextActions,
        flowDesign: result.flowDesign,
        nodeConfiguration: result.nodeConfiguration,
        payload: result.finalResult?.payload,
        trace: result.trace.slice(-20),
    };
}

export async function buildPromptLabSelfReviewRequest(args: {
    session: PromptLabSessionRecord;
    result: ProductDesignRunResult;
    language: PromptLabLanguage;
}): Promise<StructuredGenerationInput<typeof PromptLabSelfReviewSchema>> {
    const manifest = await getPromptLabManifest();

    return {
        purpose: 'lite',
        input: [
            {
                role: 'system',
                content: manifest.selfReview.systemPrompt,
            },
            {
                role: 'user',
                content: JSON.stringify({
                    language: args.language,
                    run: buildRunSnapshot(args.session, args.result),
                }),
            },
        ],
        schema: defineStructuredSchema('prompt_lab_self_review', PromptLabSelfReviewSchema),
    };
}

export async function buildPromptLabCodexPromptRequest(args: {
    session: PromptLabSessionRecord;
    result: ProductDesignRunResult;
    selfReview: PromptLabSelfReview;
    userFeedback: string;
    language: PromptLabLanguage;
}): Promise<StructuredGenerationInput<typeof PromptLabCodexPromptSchema>> {
    const manifest = await getPromptLabManifest();

    return {
        purpose: 'lite',
        input: [
            {
                role: 'system',
                content: manifest.codexPrompt.systemPrompt,
            },
            {
                role: 'user',
                content: JSON.stringify({
                    language: args.language,
                    run: buildRunSnapshot(args.session, args.result),
                    selfReview: args.selfReview,
                    userFeedback: args.userFeedback,
                }),
            },
        ],
        schema: defineStructuredSchema('prompt_lab_codex_prompt', PromptLabCodexPromptSchema),
    };
}
