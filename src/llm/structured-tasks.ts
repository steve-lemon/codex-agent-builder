// Shared structured-generation request builders used by gateway plan/reflect/finalize flows.
import { createOpenAiPlanResponseSchema, parsePlanResponse, ReflectorOutputSchema } from '../agent/schemas';
import { FinalResultSchema } from '../agent/types';
import type { FinalizerInput, PlannerInput, ReflectorInput, StructuredGenerationInput } from './types';
import { defineStructuredSchema } from './structured-schema';

/** Builds the common structured request used for planner execution. */
export function buildPlanStructuredRequest(input: PlannerInput): StructuredGenerationInput {
    return {
        input: [
            {
                role: 'system',
                content:
                    'Return a concise executable plan for an agent runtime. Use only provided tools and generate tool args that satisfy each tool parameter schema.',
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
        schema: defineStructuredSchema('plan', createOpenAiPlanResponseSchema(input.toolDefinitions)),
    };
}

/** Parses planner structured output into the runtime plan contract. */
export function parsePlanStructuredOutput(output: unknown) {
    return parsePlanResponse(output);
}

/** Builds the common structured request used for reflector execution. */
export function buildReflectStructuredRequest(input: ReflectorInput): StructuredGenerationInput {
    return {
        input: [
            { role: 'system', content: 'Decide whether run is complete.' },
            { role: 'user', content: JSON.stringify(input) },
        ],
        schema: defineStructuredSchema('reflector_output', ReflectorOutputSchema),
    };
}

/** Builds the common structured request used for finalizer execution. */
export function buildFinalizeStructuredRequest(input: FinalizerInput): StructuredGenerationInput {
    return {
        input: [
            { role: 'system', content: 'Return final concise agent result.' },
            { role: 'user', content: JSON.stringify(input) },
        ],
        schema: defineStructuredSchema('final_result', FinalResultSchema),
    };
}
