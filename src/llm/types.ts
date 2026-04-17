// LLM gateway interfaces and implementations.
import { z } from 'zod';
import type { Plan, ReflectorOutput } from '../agent/schemas';
import type { FinalResult } from '../agent/types';
import type { ToolDefinition, ToolManifest } from '../tools/types';
import type { StructuredSchema } from './structured-schema';

/** Payload sent to a planner-capable LLM gateway. */
export interface PlannerInput {
    userInput: string;
    skillName: string;
    skillInstructions: string;
    allowedTools: string[];
    toolManifests: ToolManifest[];
    toolDefinitions: ToolDefinition[];
}

/** Payload sent to a reflector-capable LLM gateway. */
export interface ReflectorInput {
    userInput: string;
    stepResults: unknown[];
}

/** Payload sent to a finalizer-capable LLM gateway. */
export interface FinalizerInput {
    userInput: string;
    skillName: string;
    stepResults: unknown[];
}

/** Generic structured-generation request used by plan, flow-design classification, and future structured tasks. */
export interface StructuredGenerationInput<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
    input: Array<{ role: 'system' | 'user'; content: string }>;
    schema: StructuredSchema<TSchema>;
}

/** LLM abstraction used by the runtime for plan, reflect, finalize, and generic structured generation. */
export interface LlmGateway {
    plan(input: PlannerInput): Promise<Plan>;
    reflect(input: ReflectorInput): Promise<ReflectorOutput>;
    finalize(input: FinalizerInput): Promise<FinalResult>;
    generateStructured<TSchema extends z.ZodTypeAny>(
        input: StructuredGenerationInput<TSchema>,
    ): Promise<z.output<TSchema>>;
}
