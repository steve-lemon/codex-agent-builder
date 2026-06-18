// Deterministic reflector helpers used by the fake LLM gateway.
import type { ReflectorInput } from './types';
import type { ReflectorOutput } from '../agent/schemas';

/** Builds the deterministic reflector result used by the fake gateway. */
export function buildDeterministicReflectorOutput(input: ReflectorInput): ReflectorOutput {
    const hasFailure = JSON.stringify(input.stepResults).includes('"ok":false');

    return {
        isComplete: true,
        reason: hasFailure ? 'Completed with tool errors' : 'All planned steps executed',
        missingItems: [],
    };
}
