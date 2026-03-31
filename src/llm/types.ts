// LLM gateway interfaces and implementations.
import type { Plan, ReflectorOutput } from '../agent/schemas';
import type { FinalResult } from '../agent/types';
import type { ToolDefinition, ToolManifest } from '../tools/types';

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

/** LLM abstraction used by the runtime for plan, reflect, and finalize phases. */
export interface LlmGateway {
    plan(input: PlannerInput): Promise<Plan>;
    reflect(input: ReflectorInput): Promise<ReflectorOutput>;
    finalize(input: FinalizerInput): Promise<FinalResult>;
}
