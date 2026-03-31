// Agent runtime flow and data contracts.
import { PlanSchema, type Plan } from './schemas';
import type { LlmGateway } from '../llm/types';
import type { ToolDefinition, ToolManifest } from '../tools/types';
import { AgentError } from '../errors/agent-error';

/** Validates planner output returned from the configured LLM gateway. */
export class Planner {
    constructor(private readonly llm: LlmGateway) {}

    async createPlan(input: {
        userInput: string;
        skillName: string;
        skillInstructions: string;
        allowedTools: string[];
        toolManifests: ToolManifest[];
        toolDefinitions: ToolDefinition[];
    }): Promise<Plan> {
        const plan = await this.llm.plan({
            userInput: input.userInput,
            skillName: input.skillName,
            skillInstructions: input.skillInstructions,
            allowedTools: input.allowedTools,
            toolManifests: input.toolManifests,
            toolDefinitions: input.toolDefinitions,
        });
        return this.validatePlan(plan, input.toolDefinitions);
    }

    /** Rejects plans that reference unavailable tools or invalid tool arguments before execution begins. */
    private validatePlan(plan: Plan, toolDefinitions: ToolDefinition[]): Plan {
        const parsedPlan = PlanSchema.parse(plan);
        const toolMap = new Map(toolDefinitions.map(tool => [tool.name, tool]));

        for (const step of parsedPlan.steps) {
            for (const toolCall of step.toolCalls ?? []) {
                const tool = toolMap.get(toolCall.toolName);
                if (!tool) {
                    throw new AgentError(
                        `Planner returned tool ${toolCall.toolName} that is not available in this run`,
                    );
                }

                const validatedArgs = tool.parameters.safeParse(toolCall.args);
                if (!validatedArgs.success) {
                    throw new AgentError(
                        `Planner returned invalid args for ${toolCall.toolName}: ${validatedArgs.error.issues
                            .map(issue => issue.message)
                            .join(', ')}`,
                    );
                }

                toolCall.args = validatedArgs.data as Record<string, unknown>;
            }
        }

        return parsedPlan;
    }
}
