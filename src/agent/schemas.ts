// Agent runtime flow and data contracts.
import { z } from 'zod';

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

/** Reflector output describing completeness and missing work. */
export const ReflectorOutputSchema = z.object({
    isComplete: z.boolean(),
    reason: z.string(),
    missingItems: z.array(z.string()).default([]),
});

export type Plan = z.infer<typeof PlanSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ReflectorOutput = z.infer<typeof ReflectorOutputSchema>;
