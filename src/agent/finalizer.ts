// Agent runtime flow and data contracts.
import { FinalResultSchema, type FinalResult } from './types';
import type { LlmGateway } from '../llm/types';

/** Validates and returns the final structured result for a completed run. */
export class Finalizer {
    constructor(private readonly llm: LlmGateway) {}

    async finalize(input: { userInput: string; skillName: string; stepResults: unknown[] }): Promise<FinalResult> {
        const result = await this.llm.finalize(input);
        return FinalResultSchema.parse(result) as FinalResult;
    }
}
