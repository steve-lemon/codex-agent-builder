// Agent runtime flow and data contracts.
import { PlanSchema, type Plan } from './schemas';
import type { LlmGateway } from '../llm/types';

/** Validates planner output returned from the configured LLM gateway. */
export class Planner {
    constructor(private readonly llm: LlmGateway) {}

    async createPlan(input: {
        userInput: string;
        skillName: string;
        skillInstructions: string;
        allowedTools: string[];
    }): Promise<Plan> {
        const plan = await this.llm.plan(input);
        return PlanSchema.parse(plan);
    }
}
