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
export const PlanStepResponseSchema = z.object({
    id: z.string().min(1),
    mode: StepModeSchema,
    description: z.string().min(1),
    toolCalls: z.array(ToolCallSchema).nullable(),
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
            toolCalls: step.toolCalls ?? undefined,
            reasoning: step.reasoning ?? undefined,
        })),
    });
}

export type Plan = z.infer<typeof PlanSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ReflectorOutput = z.infer<typeof ReflectorOutputSchema>;
