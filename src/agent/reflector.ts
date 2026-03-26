// Agent runtime flow and data contracts.
import { ReflectorOutputSchema, type ReflectorOutput } from './schemas';
import type { LlmGateway } from '../llm/types';

export class Reflector {
  constructor(private readonly llm: LlmGateway) {}

  async reflect(input: { userInput: string; stepResults: unknown[] }): Promise<ReflectorOutput> {
    const output = await this.llm.reflect(input);
    return ReflectorOutputSchema.parse(output);
  }
}
