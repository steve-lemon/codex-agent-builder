// Shared structured-generation request builders used by gateway plan/reflect/finalize flows.
import { PlanResponseSchema, parsePlanResponse, ReflectorOutputSchema } from '../agent/schemas';
import { FinalResultResponseSchema } from '../agent/types';
import type { FinalizerInput, PlannerInput, ReflectorInput, StructuredGenerationInput } from './types';
import { defineStructuredSchema } from './structured-schema';
import { getFinalizeSystemPrompt, getPlanSystemPrompt, getReflectSystemPrompt } from './structured-task-resources';

/** Builds the common structured request used for planner execution. */
export async function buildPlanStructuredRequest(input: PlannerInput): Promise<StructuredGenerationInput> {
    return {
        purpose: 'main',
        input: [
            {
                role: 'system',
                content: await getPlanSystemPrompt(),
            },
            {
                role: 'user',
                content: JSON.stringify({
                    userInput: input.userInput,
                    skillName: input.skillName,
                    skillInstructions: input.skillInstructions,
                    allowedTools: input.allowedTools,
                    toolManifests: input.toolManifests,
                }),
            },
        ],
        // OpenAI structured outputs are strict about optional object fields. Keep planner
        // output generic here and let later runtime/tool validation enforce tool-specific args.
        schema: defineStructuredSchema('plan', PlanResponseSchema),
    };
}

/** Parses planner structured output into the runtime plan contract. */
export function parsePlanStructuredOutput(output: unknown) {
    return parsePlanResponse(output);
}

/** Builds the common structured request used for reflector execution. */
export async function buildReflectStructuredRequest(input: ReflectorInput): Promise<StructuredGenerationInput> {
    return {
        purpose: 'lite',
        input: [
            { role: 'system', content: await getReflectSystemPrompt() },
            { role: 'user', content: JSON.stringify(input) },
        ],
        schema: defineStructuredSchema('reflector_output', ReflectorOutputSchema),
    };
}

/** Builds the common structured request used for finalizer execution. */
export async function buildFinalizeStructuredRequest(input: FinalizerInput): Promise<StructuredGenerationInput> {
    return {
        purpose: 'lite',
        input: [
            { role: 'system', content: await getFinalizeSystemPrompt() },
            { role: 'user', content: JSON.stringify(input) },
        ],
        schema: defineStructuredSchema('final_result', FinalResultResponseSchema),
    };
}
