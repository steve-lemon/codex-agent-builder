// Agent runtime flow and data contracts.
import { z } from 'zod';
import type { ToolDefinition } from '../tools';
import { AgentError } from '../errors/agent-error';

/** Supported execution modes for a planner-produced step. */
export const StepModeSchema = z.enum(['parallel-tools', 'single-tool', 'reasoning', 'finalize']);

/** Normalized tool call embedded in a plan step. */
export const ToolCallSchema = z.object({
    toolName: z.string().min(1),
    args: z.record(z.unknown()).default({}),
});

/** Validated plan step consumed by the step executor. */
export const PlanStepSchema = z.object({
    id: z.string().min(1),
    mode: StepModeSchema,
    description: z.string().min(1),
    toolCalls: z.array(ToolCallSchema).optional(),
    reasoning: z.string().optional(),
});

/** Full planner output consumed by the runtime. */
export const PlanSchema = z.object({
    steps: z.array(PlanStepSchema).min(1),
});

/** Response schema for planner outputs with generic tool calls. */
export const ToolCallResponseSchema = z.object({
    toolName: z.string().min(1),
    argsJson: z.string().default('{}'),
});

/** Response schema for planner outputs with generic tool calls. */
export const PlanStepResponseSchema = z.object({
    id: z.string().min(1),
    mode: StepModeSchema,
    description: z.string().min(1),
    toolCalls: z.array(ToolCallResponseSchema).nullable(),
    reasoning: z.string().nullable(),
});

/** Generic planner schema used for parsing non-dynamic planner outputs. */
export const PlanResponseSchema = z.object({
    steps: z.array(PlanStepResponseSchema).min(1),
});

/** Builds an OpenAI-safe planner response schema by specializing args per allowed tool. */
export function createOpenAiPlanResponseSchema(toolDefinitions: ToolDefinition[]) {
    if (toolDefinitions.length === 0) {
        throw new AgentError('At least one tool definition is required to build a plan response schema');
    }

    const toolCallSchemas = toolDefinitions.map(tool =>
        z.object({
            toolName: z.literal(tool.name),
            args: tool.parameters,
        }),
    );

    const toolCallSchema = toolCallSchemas.length === 1 ? toolCallSchemas[0] : z.union(toolCallSchemas as never);

    return z.object({
        steps: z
            .array(
                z.object({
                    id: z.string().min(1),
                    mode: StepModeSchema,
                    description: z.string().min(1),
                    toolCalls: z.array(toolCallSchema).nullable(),
                    reasoning: z.string().nullable(),
                }),
            )
            .min(1),
    });
}

/** Reflector output describing completeness and missing work. */
export const ReflectorOutputSchema = z.object({
    isComplete: z.boolean(),
    reason: z.string(),
    missingItems: z.array(z.string()).default([]),
});

/** Normalizes a gateway planner payload into the runtime Plan shape. */
export function parsePlanResponse(input: unknown): Plan {
    const parsed = PlanResponseSchema.parse(input);
    return PlanSchema.parse({
        steps: parsed.steps.map(step => ({
            ...step,
            toolCalls:
                step.toolCalls?.map(toolCall => ({
                    toolName: toolCall.toolName,
                    args: safeParsePlannerArgs(toolCall.argsJson),
                })) ?? undefined,
            reasoning: step.reasoning ?? undefined,
        })),
    });
}

function safeParsePlannerArgs(argsJson: string): Record<string, unknown> {
    const normalizedArgsJson = normalizePlannerArgsJson(argsJson);

    try {
        const parsed = JSON.parse(normalizedArgsJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        throw new Error('Planner args must decode to an object');
    } catch (error) {
        throw new AgentError(`Planner returned invalid tool args JSON (preview: ${JSON.stringify(argsJson.slice(0, 120))})`, {
            cause: AgentError.rootCause(error),
            code: 'PLAN_ARGS_JSON_INVALID',
        });
    }
}

function normalizePlannerArgsJson(argsJson: string): string {
    const trimmed = argsJson.trim();
    if (!trimmed) {
        return '{}';
    }

    const withoutCodeFence = trimmed
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

    const extractedJson = extractFirstJsonObject(withoutCodeFence);
    return extractedJson ?? withoutCodeFence;
}

function extractFirstJsonObject(input: string): string | undefined {
    const startIndex = input.indexOf('{');
    if (startIndex < 0) {
        return undefined;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = startIndex; index < input.length; index += 1) {
        const char = input[index];
        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === '\\') {
            escaped = true;
            continue;
        }

        if (char === '"') {
            inString = !inString;
            continue;
        }

        if (inString) {
            continue;
        }

        if (char === '{') {
            depth += 1;
            continue;
        }

        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return input.slice(startIndex, index + 1);
            }
        }
    }

    return undefined;
}

export type Plan = z.infer<typeof PlanSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ReflectorOutput = z.infer<typeof ReflectorOutputSchema>;
