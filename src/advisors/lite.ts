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
    emitLogs?: boolean;
    onDecision?: (event: {
        type: 'model' | 'fallback-no-gateway' | 'fallback-threshold' | 'fallback-error';
        error?: unknown;
        durationMs?: number;
    }) => void;
    fallback: () => Promise<TResult> | TResult;
}

export async function runLiteAdvisor<TSchema extends z.ZodTypeAny, TResult>(
    args: LiteAdvisorRunArgs<TSchema, TResult>,
): Promise<TResult> {
    // TODO(advisors): Add richer policy hooks so fallback can also react to weak
    // rationales, schema-specific quality checks, or advisor-defined abstain signals.
    if (!args.gateway) {
        args.onDecision?.({ type: 'fallback-no-gateway' });
        return await args.fallback();
    }

    const startedAt = Date.now();
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
        const durationMs = Date.now() - startedAt;
        if (args.shouldFallback?.(output)) {
            args.onDecision?.({ type: 'fallback-threshold', durationMs });
            if (args.emitLogs !== false) {
                logWarn({
                    scope: args.scope,
                    action: 'lite_advisor_low_confidence_fallback',
                    message: 'Lite advisor result did not meet the configured confidence threshold. Falling back.',
                    data: {
                        advisorId: args.advisorId,
                        durationMs,
                    },
                });
            }
            return await args.fallback();
        }
        args.onDecision?.({ type: 'model', durationMs });
        if (args.emitLogs !== false) {
            logDebug({
                scope: args.scope,
                action: 'lite_advisor_selected',
                message: 'Lite advisor selected a result.',
                data: {
                    advisorId: args.advisorId,
                    durationMs,
                },
            });
        }
        return args.mapResult(output);
    } catch (error) {
        args.onDecision?.({ type: 'fallback-error', error, durationMs: Date.now() - startedAt });
        if (args.emitLogs !== false) {
            logWarn({
                scope: args.scope,
                action: 'lite_advisor_fallback',
                message: 'Lite advisor failed. Falling back to deterministic advisor.',
                data: {
                    advisorId: args.advisorId,
                    fallbackNote: args.fallbackNote,
                    durationMs: Date.now() - startedAt,
                    error:
                        error instanceof Error
                            ? {
                                  name: error.name,
                                  message: error.message,
                              }
                            : { message: String(error) },
                },
            });
        }
        return await args.fallback();
    }
}
