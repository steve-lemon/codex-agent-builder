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
import type { PlannerStrategyBrief } from '../flow/design/architecture';
import { z, ZodFirstPartyTypeKind } from 'zod';

const REFERENCE_ONLY_TOOL_ARGS: Readonly<Record<string, readonly string[]>> = {
    designFlowDraft: ['preflight'],
    validateFlowDraft: ['flow'],
    runFlowSample: ['flow'],
    designFlowNodeConfigurations: ['flow'],
    validateFlowNodeConfigurations: ['flow'],
};

const REFERENCE_ARG_PRODUCERS: Readonly<
    Record<string, Partial<Record<string, { toolNames: readonly string[]; path: string }>>>
> = {
    designFlowDraft: {
        preflight: {
            toolNames: ['prevalidateFlowDesignRequest', 'assessFlowFeasibility'],
            path: 'toolResults.0.data',
        },
    },
    designFlowNodeConfigurations: {
        flow: {
            toolNames: ['designFlowDraft'],
            path: 'toolResults.0.data.flow',
        },
    },
    validateFlowNodeConfigurations: {
        flow: {
            toolNames: ['designFlowNodeConfigurations', 'designFlowDraft'],
            path: 'toolResults.0.data.flow',
        },
    },
    validateFlowDraft: {
        flow: {
            toolNames: ['designFlowNodeConfigurations', 'designFlowDraft'],
            path: 'toolResults.0.data.flow',
        },
    },
    runFlowSample: {
        flow: {
            toolNames: ['designFlowNodeConfigurations', 'designFlowDraft'],
            path: 'toolResults.0.data.flow',
        },
    },
};

// TODO(planner): Planner remains the dominant end-to-end latency cost in prompt-lab runs.
// Next step should focus on:
// 1) introducing a smaller flow-designer tactical mode that emits a fixed skeleton plus
//    a minimal repair pass instead of a full structured plan round,
// 2) further shrinking planner-visible payloads (tool subset, strategy brief, instructions),
// 3) measuring whether the remaining cost is prompt size, model latency, or structured-plan parsing.

function findPreviousReference(
    steps: PlanStep[],
    currentStepIndex: number,
    config: { toolNames: readonly string[]; path: string },
): StepResultReference | undefined {
    for (let index = currentStepIndex - 1; index >= 0; index -= 1) {
        const step = steps[index];
        if (!step) {
            continue;
        }
        const matchingToolCall = step.toolCalls?.find(toolCall => config.toolNames.includes(toolCall.toolName));
        if (matchingToolCall) {
            return {
                $fromStep: step.id,
                path: config.path,
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
        if (value === undefined) {
            continue;
        }
        if (isStepResultReference(value)) {
            continue;
        }

        const producerConfig = REFERENCE_ARG_PRODUCERS[toolName]?.[argName];
        const repairedReference = producerConfig
            ? findPreviousReference(steps, currentStepIndex, producerConfig)
            : undefined;
        if (repairedReference) {
            args[argName] = repairedReference;
            continue;
        }

        throw new AgentError(
            `Planner must pass ${toolName}.${argName} via a step reference instead of an inline value`,
            {
                code: 'PLANNER_REFERENCE_REQUIRED',
                transient: false,
            },
        );
    }
}

function buildReferenceAwareValidationArgs(
    schema: z.ZodTypeAny,
    toolName: string,
    args: Record<string, unknown>,
): Record<string, unknown> {
    const referenceArgs = new Set(REFERENCE_ONLY_TOOL_ARGS[toolName] ?? []);
    return replaceStepReferencesForValidation(schema, args, referenceArgs, []) as Record<string, unknown>;
}

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
    let current = schema;

    while (true) {
        const typeName = current._def.typeName;
        if (typeName === ZodFirstPartyTypeKind.ZodOptional || typeName === ZodFirstPartyTypeKind.ZodNullable) {
            current = (current as z.ZodOptional<z.ZodTypeAny> | z.ZodNullable<z.ZodTypeAny>).unwrap();
            continue;
        }
        if (typeName === ZodFirstPartyTypeKind.ZodDefault) {
            current = (current as z.ZodDefault<z.ZodTypeAny>)._def.innerType;
            continue;
        }
        if (typeName === ZodFirstPartyTypeKind.ZodEffects) {
            current = (current as z.ZodEffects<z.ZodTypeAny>)._def.schema;
            continue;
        }
        return current;
    }
}

function buildSchemaPlaceholder(schema: z.ZodTypeAny): unknown {
    const unwrapped = unwrapSchema(schema);
    switch (unwrapped._def.typeName) {
        case ZodFirstPartyTypeKind.ZodString:
            return '';
        case ZodFirstPartyTypeKind.ZodNumber:
            return 1;
        case ZodFirstPartyTypeKind.ZodBoolean:
            return false;
        case ZodFirstPartyTypeKind.ZodArray:
            return [];
        case ZodFirstPartyTypeKind.ZodRecord:
            return {};
        case ZodFirstPartyTypeKind.ZodLiteral:
            return (unwrapped as z.ZodLiteral<unknown>).value;
        case ZodFirstPartyTypeKind.ZodEnum:
            return (unwrapped as z.ZodEnum<[string, ...string[]]>)._def.values[0] ?? '';
        case ZodFirstPartyTypeKind.ZodNativeEnum: {
            const values = Object.values((unwrapped as z.ZodNativeEnum<any>).enum).filter(
                value => typeof value === 'string' || typeof value === 'number',
            );
            return values[0] ?? '';
        }
        case ZodFirstPartyTypeKind.ZodObject: {
            const shape = (unwrapped as z.AnyZodObject).shape;
            return Object.fromEntries(
                Object.entries(shape).map(([key, childSchema]) => [
                    key,
                    buildSchemaPlaceholder(childSchema as z.ZodTypeAny),
                ]),
            );
        }
        case ZodFirstPartyTypeKind.ZodUnion: {
            const option = (unwrapped as z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>)._def.options[0];
            return option ? buildSchemaPlaceholder(option) : {};
        }
        default:
            return {};
    }
}

function replaceStepReferencesForValidation(
    schema: z.ZodTypeAny,
    value: unknown,
    rootReferenceArgs: ReadonlySet<string>,
    path: string[],
): unknown {
    const unwrapped = unwrapSchema(schema);

    if (isStepResultReference(value)) {
        const isRootReferenceArg = path.length === 1 && rootReferenceArgs.has(path[0] ?? '');
        if (isRootReferenceArg || path.length > 0) {
            return buildSchemaPlaceholder(unwrapped);
        }
        return value;
    }

    if (unwrapped._def.typeName === ZodFirstPartyTypeKind.ZodObject && typeof value === 'object' && value !== null) {
        const shape = (unwrapped as z.AnyZodObject).shape;
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
                key,
                replaceStepReferencesForValidation(
                    shape[key as keyof typeof shape] ?? z.unknown(),
                    nested,
                    rootReferenceArgs,
                    [...path, key],
                ),
            ]),
        );
    }

    if (unwrapped._def.typeName === ZodFirstPartyTypeKind.ZodArray && Array.isArray(value)) {
        const itemSchema = (unwrapped as z.ZodArray<z.ZodTypeAny>)._def.type;
        return value.map((item, index) =>
            replaceStepReferencesForValidation(itemSchema, item, rootReferenceArgs, [...path, String(index)]),
        );
    }

    return value;
}

/** Validates planner output returned from the configured LLM gateway. */
export class Planner {
    constructor(private readonly llm: LlmGateway) {}

    async createPlan(input: {
        userInput: string;
        skillName: string;
        skillInstructions: string;
        plannerInstructions?: string;
        strategyBrief?: PlannerStrategyBrief;
        allowedTools: string[];
        toolManifests: ToolManifest[];
        toolDefinitions: ToolDefinition[];
        onTraceEvent?: (type: string, data?: Record<string, unknown>) => void;
    }): Promise<Plan> {
        const plannerInput = {
            userInput: input.userInput,
            skillName: input.skillName,
            skillInstructions: input.skillInstructions,
            plannerInstructions: input.plannerInstructions,
            strategyBrief: input.strategyBrief,
            allowedTools: input.allowedTools,
            toolManifests: input.toolManifests,
            toolDefinitions: input.toolDefinitions,
        };
        let plan: Plan;
        try {
            input.onTraceEvent?.('planner_llm_start', {});
            plan = await this.llm.plan(plannerInput);
            input.onTraceEvent?.('planner_llm_end', { success: true });
        } catch (error) {
            input.onTraceEvent?.('planner_llm_end', { success: false });
            const fallbackPlan = await this.buildDeterministicFallbackPlan(plannerInput, error, input.onTraceEvent);
            if (!fallbackPlan) {
                throw error;
            }
            plan = fallbackPlan;
        }
        try {
            input.onTraceEvent?.('planner_validation_start', {});
            const validatedPlan = this.validatePlan(plan, input.toolDefinitions);
            input.onTraceEvent?.('planner_validation_end', { success: true });
            return validatedPlan;
        } catch (error) {
            input.onTraceEvent?.('planner_validation_end', { success: false });
            const fallbackPlan = await this.buildDeterministicFallbackPlan(plannerInput, error, input.onTraceEvent);
            if (!fallbackPlan) {
                throw error;
            }
            input.onTraceEvent?.('planner_validation_start', { source: 'fallback' });
            const validatedPlan = this.validatePlan(fallbackPlan, input.toolDefinitions);
            input.onTraceEvent?.('planner_validation_end', { success: true, source: 'fallback' });
            return validatedPlan;
        }
    }

    private async buildDeterministicFallbackPlan(
        input: {
            userInput: string;
            skillName: string;
            skillInstructions: string;
            plannerInstructions?: string;
            strategyBrief?: PlannerStrategyBrief;
            allowedTools: string[];
            toolManifests: ToolManifest[];
            toolDefinitions: ToolDefinition[];
        },
        error: unknown,
        onTraceEvent?: (type: string, data?: Record<string, unknown>) => void,
    ): Promise<Plan | undefined> {
        const rootCause = AgentError.rootCause(error);
        const code = error instanceof AgentError ? error.code : undefined;
        const shouldFallback =
            code === 'PLAN_ARGS_JSON_INVALID' ||
            code === 'OPENAI_STRUCTURED_PARSE_FAILED' ||
            code === 'GEMINI_STRUCTURED_PARSE_FAILED' ||
            (error instanceof AgentError && error.message.startsWith('Planner returned invalid args for'));

        if (!shouldFallback) {
            return undefined;
        }

        onTraceEvent?.('planner_fallback_start', {
            code: code ?? 'unknown',
        });

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

        try {
            if (input.skillName === 'flow-designer') {
                const plan = await buildFlowDesignerPlan(input, ensureToolAvailable);
                onTraceEvent?.('planner_fallback_end', { used: true, skillName: input.skillName });
                return plan;
            }
            if (input.skillName === 'flow-preflight-validator') {
                const plan = await buildFlowPreflightValidatorPlan(input, ensureToolAvailable);
                onTraceEvent?.('planner_fallback_end', { used: true, skillName: input.skillName });
                return plan;
            }
            if (input.skillName === 'node-config-designer') {
                const plan = await buildNodeConfigDesignerPlan();
                onTraceEvent?.('planner_fallback_end', { used: true, skillName: input.skillName });
                return plan;
            }
        } catch (fallbackError) {
            if (fallbackError instanceof AgentError && fallbackError.code === 'PLANNER_FALLBACK_TOOL_UNAVAILABLE') {
                onTraceEvent?.('planner_fallback_end', { used: false, skillName: input.skillName });
                return undefined;
            }
            throw fallbackError;
        }

        onTraceEvent?.('planner_fallback_end', { used: false, skillName: input.skillName });
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

                let validationArgs = toolCall.args;
                if (containsStepReferences(toolCall.args)) {
                    validateStepReferences(toolCall.args);
                    validationArgs = buildReferenceAwareValidationArgs(
                        tool.parameters,
                        toolCall.toolName,
                        toolCall.args,
                    );
                }

                const validatedArgs = tool.parameters.safeParse(validationArgs);
                if (!validatedArgs.success) {
                    throw new AgentError(
                        `Planner returned invalid args for ${toolCall.toolName}: ${validatedArgs.error.issues
                            .map(issue => issue.message)
                            .join(', ')}`,
                    );
                }

                if (!containsStepReferences(toolCall.args)) {
                    toolCall.args = validatedArgs.data as Record<string, unknown>;
                }
            }
        }

        return parsedPlan;
    }
}
