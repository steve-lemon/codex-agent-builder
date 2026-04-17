import type { z } from 'zod';
import { logDebug, logWarn } from '../diagnostics/logger';
import type { LlmGateway, StructuredGenerationInput } from '../llm/types';
import type { StructuredSchema } from '../llm/structured-schema';

export interface LiteAdvisorRunArgs<TSchema extends z.ZodTypeAny, TResult> {
    advisorId: string;
    scope: string;
    gateway?: LlmGateway;
    systemPrompt: string;
    fallbackNote?: string;
    schema: StructuredSchema<TSchema>;
    input: unknown;
    mapResult: (output: z.output<TSchema>) => TResult;
    shouldFallback?: (output: z.output<TSchema>) => boolean;
    fallback: () => Promise<TResult> | TResult;
}

export async function runLiteAdvisor<TSchema extends z.ZodTypeAny, TResult>(
    args: LiteAdvisorRunArgs<TSchema, TResult>,
): Promise<TResult> {
    // TODO(advisors): Add richer policy hooks so fallback can also react to weak
    // rationales, schema-specific quality checks, or advisor-defined abstain signals.
    if (!args.gateway) {
        return await args.fallback();
    }

    try {
        const request: StructuredGenerationInput<TSchema> = {
            purpose: 'lite',
            input: [
                { role: 'system', content: args.systemPrompt },
                { role: 'user', content: JSON.stringify(args.input) },
            ],
            schema: args.schema,
        };
        const output = await args.gateway.generateStructured(request);
        if (args.shouldFallback?.(output)) {
            logWarn({
                scope: args.scope,
                action: 'lite_advisor_low_confidence_fallback',
                message: 'Lite advisor result did not meet the configured confidence threshold. Falling back.',
                data: {
                    advisorId: args.advisorId,
                },
            });
            return await args.fallback();
        }
        logDebug({
            scope: args.scope,
            action: 'lite_advisor_selected',
            message: 'Lite advisor selected a result.',
            data: {
                advisorId: args.advisorId,
            },
        });
        return args.mapResult(output);
    } catch (error) {
        logWarn({
            scope: args.scope,
            action: 'lite_advisor_fallback',
            message: 'Lite advisor failed. Falling back to deterministic advisor.',
            data: {
                advisorId: args.advisorId,
                fallbackNote: args.fallbackNote,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              message: error.message,
                          }
                        : { message: String(error) },
            },
        });
        return await args.fallback();
    }
}
