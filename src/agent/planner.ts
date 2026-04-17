// Agent runtime flow and data contracts.
import { PlanSchema, type Plan } from './schemas';
import type { LlmGateway } from '../llm/types';
import type { ToolDefinition, ToolManifest } from '../tools';
import { AgentError } from '../errors/agent-error';
import {
    containsStepReferences,
    isStepResultReference,
    type StepResultReference,
    validateStepReferences,
} from './step-references';
import type { PlanStep } from './schemas';
import {
    buildFlowDesignerPlan,
    buildFlowPreflightValidatorPlan,
    buildNodeConfigDesignerPlan,
} from '../llm/fake-plan-builders';

const REFERENCE_ONLY_TOOL_ARGS: Readonly<Record<string, readonly string[]>> = {
    validateFlowDraft: ['flow'],
    runFlowSample: ['flow'],
    designFlowNodeConfigurations: ['flow'],
    validateFlowNodeConfigurations: ['flow'],
};

const FLOW_REFERENCE_PRODUCERS: Readonly<Record<string, readonly string[]>> = {
    designFlowNodeConfigurations: ['designFlowDraft'],
    validateFlowNodeConfigurations: ['designFlowNodeConfigurations', 'designFlowDraft'],
    validateFlowDraft: ['designFlowNodeConfigurations', 'designFlowDraft'],
    runFlowSample: ['designFlowNodeConfigurations', 'designFlowDraft'],
};

function findPreviousFlowReference(
    steps: PlanStep[],
    currentStepIndex: number,
    toolNames: readonly string[],
): StepResultReference | undefined {
    for (let index = currentStepIndex - 1; index >= 0; index -= 1) {
        const step = steps[index];
        if (!step) {
            continue;
        }
        const matchingToolCall = step.toolCalls?.find(toolCall => toolNames.includes(toolCall.toolName));
        if (matchingToolCall) {
            return {
                $fromStep: step.id,
                path: 'toolResults.0.data.flow',
            };
        }
    }

    return undefined;
}

function validateReferenceOnlyArgs(
    steps: PlanStep[],
    currentStepIndex: number,
    toolName: string,
    args: Record<string, unknown>,
): void {
    const requiredReferenceArgs = REFERENCE_ONLY_TOOL_ARGS[toolName];
    if (!requiredReferenceArgs) {
        return;
    }

    for (const argName of requiredReferenceArgs) {
        const value = args[argName];
        if (isStepResultReference(value)) {
            continue;
        }

        const producers = FLOW_REFERENCE_PRODUCERS[toolName];
        const repairedReference =
            argName === 'flow' && producers
                ? findPreviousFlowReference(steps, currentStepIndex, producers)
                : undefined;
        if (repairedReference) {
            args[argName] = repairedReference;
            continue;
        }

        throw new AgentError(`Planner must pass ${toolName}.${argName} via a step reference instead of an inline value`, {
            code: 'PLANNER_REFERENCE_REQUIRED',
            transient: false,
        });
    }
}

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
        const plannerInput = {
            userInput: input.userInput,
            skillName: input.skillName,
            skillInstructions: input.skillInstructions,
            allowedTools: input.allowedTools,
            toolManifests: input.toolManifests,
            toolDefinitions: input.toolDefinitions,
        };
        let plan: Plan;
        try {
            plan = await this.llm.plan(plannerInput);
        } catch (error) {
            const fallbackPlan = await this.buildDeterministicFallbackPlan(plannerInput, error);
            if (!fallbackPlan) {
                throw error;
            }
            plan = fallbackPlan;
        }
        return this.validatePlan(plan, input.toolDefinitions);
    }

    private async buildDeterministicFallbackPlan(
        input: {
            userInput: string;
            skillName: string;
            skillInstructions: string;
            allowedTools: string[];
            toolManifests: ToolManifest[];
            toolDefinitions: ToolDefinition[];
        },
        error: unknown,
    ): Promise<Plan | undefined> {
        const rootCause = AgentError.rootCause(error);
        const code = error instanceof AgentError ? error.code : undefined;
        const shouldFallback =
            code === 'PLAN_ARGS_JSON_INVALID' ||
            code === 'OPENAI_STRUCTURED_PARSE_FAILED' ||
            code === 'GEMINI_STRUCTURED_PARSE_FAILED';

        if (!shouldFallback) {
            return undefined;
        }

        const ensureToolAvailable = (toolName: string): string => {
            if (!input.allowedTools.includes(toolName)) {
                throw new AgentError(
                    `Deterministic planner fallback required tool ${toolName}, but it is not available in this run`,
                    {
                        code: 'PLANNER_FALLBACK_TOOL_UNAVAILABLE',
                        cause: rootCause,
                    },
                );
            }
            return toolName;
        };

        if (input.skillName === 'flow-designer') {
            return await buildFlowDesignerPlan(input, ensureToolAvailable);
        }
        if (input.skillName === 'flow-preflight-validator') {
            return await buildFlowPreflightValidatorPlan(input, ensureToolAvailable);
        }
        if (input.skillName === 'node-config-designer') {
            return await buildNodeConfigDesignerPlan();
        }

        return undefined;
    }

    /** Rejects plans that reference unavailable tools or invalid tool arguments before execution begins. */
    private validatePlan(plan: Plan, toolDefinitions: ToolDefinition[]): Plan {
        const parsedPlan = PlanSchema.parse(plan);
        const toolMap = new Map(toolDefinitions.map(tool => [tool.name, tool]));

        for (const [stepIndex, step] of parsedPlan.steps.entries()) {
            for (const toolCall of step.toolCalls ?? []) {
                const tool = toolMap.get(toolCall.toolName);
                if (!tool) {
                    throw new AgentError(
                        `Planner returned tool ${toolCall.toolName} that is not available in this run`,
                    );
                }

                validateReferenceOnlyArgs(parsedPlan.steps, stepIndex, toolCall.toolName, toolCall.args);

                if (containsStepReferences(toolCall.args)) {
                    validateStepReferences(toolCall.args);
                    continue;
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
