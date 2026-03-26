// LLM gateway interfaces and implementations.
import type { Plan, ReflectorOutput } from '../agent/schemas';
import type { FinalResult } from '../agent/types';

export interface PlannerInput {
  userInput: string;
  skillName: string;
  skillInstructions: string;
  allowedTools: string[];
}

export interface ReflectorInput {
  userInput: string;
  stepResults: unknown[];
}

export interface FinalizerInput {
  userInput: string;
  skillName: string;
  stepResults: unknown[];
}

export interface LlmGateway {
  plan(input: PlannerInput): Promise<Plan>;
  reflect(input: ReflectorInput): Promise<ReflectorOutput>;
  finalize(input: FinalizerInput): Promise<FinalResult>;
}
