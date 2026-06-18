// Shared structured-generation request builders used by gateway plan/reflect/finalize flows.
import { PlanResponseSchema, parsePlanResponse, ReflectorOutputSchema } from '../agent/schemas';
import { FinalResultResponseSchema } from '../agent/types';
import type { ToolManifest } from '../tools';
import type { FinalizerInput, PlannerInput, ReflectorInput, StructuredGenerationInput } from './types';
import { defineStructuredSchema } from './structured-schema';
import { getFinalizeSystemPrompt, getPlanSystemPrompt, getReflectSystemPrompt } from './structured-task-resources';

function summarizeJsonSchemaType(schema: unknown): string {
    if (!schema || typeof schema !== 'object') {
        return 'unknown';
    }
    const record = schema as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type : undefined;
    if (type === 'array') {
        return `array<${summarizeJsonSchemaType(record.items)}>`;
    }
    return type ?? 'unknown';
}

function buildPlannerParameterHints(schema: unknown): Array<{ name: string; type: string; required: boolean }> {
    if (!schema || typeof schema !== 'object') {
        return [];
    }

    const record = schema as Record<string, unknown>;
    const properties =
        record.properties && typeof record.properties === 'object'
            ? (record.properties as Record<string, unknown>)
            : undefined;
    const required = Array.isArray(record.required)
        ? new Set(record.required.filter((value): value is string => typeof value === 'string'))
        : new Set<string>();

    if (!properties) {
        return [];
    }

    return Object.entries(properties)
        .slice(0, 8)
        .map(([name, propertySchema]) => ({
            name,
            type: summarizeJsonSchemaType(propertySchema),
            required: required.has(name),
        }));
}

function compactToolManifestForPlanner(tool: ToolManifest) {
    return {
        name: tool.name,
        description: tool.description,
        riskLevel: tool.riskLevel,
        requiresConfirmation: tool.requiresConfirmation,
        parallelSafe: tool.parallelSafe,
        parameterHints: buildPlannerParameterHints(tool.parametersJsonSchema),
    };
}

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
                    skillInstructions: input.plannerInstructions ?? input.skillInstructions,
                    strategyBrief: input.strategyBrief,
                    allowedTools: input.allowedTools,
                    toolManifests: input.toolManifests.map(compactToolManifestForPlanner),
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
