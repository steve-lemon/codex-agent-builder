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
import { z, ZodFirstPartyTypeKind } from 'zod';

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
            argName === 'flow' && producers ? findPreviousFlowReference(steps, currentStepIndex, producers) : undefined;
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
        try {
            return this.validatePlan(plan, input.toolDefinitions);
        } catch (error) {
            const fallbackPlan = await this.buildDeterministicFallbackPlan(plannerInput, error);
            if (!fallbackPlan) {
                throw error;
            }
            return this.validatePlan(fallbackPlan, input.toolDefinitions);
        }
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
            code === 'GEMINI_STRUCTURED_PARSE_FAILED' ||
            (error instanceof AgentError && error.message.startsWith('Planner returned invalid args for'));

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

        try {
            if (input.skillName === 'flow-designer') {
                return await buildFlowDesignerPlan(input, ensureToolAvailable);
            }
            if (input.skillName === 'flow-preflight-validator') {
                return await buildFlowPreflightValidatorPlan(input, ensureToolAvailable);
            }
            if (input.skillName === 'node-config-designer') {
                return await buildNodeConfigDesignerPlan();
            }
        } catch (fallbackError) {
            if (fallbackError instanceof AgentError && fallbackError.code === 'PLANNER_FALLBACK_TOOL_UNAVAILABLE') {
                return undefined;
            }
            throw fallbackError;
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
