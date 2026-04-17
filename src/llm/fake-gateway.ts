// LLM gateway interfaces and implementations.
import { z } from 'zod';
import {
    formatFlowDesignerFinalResult,
    formatFlowPreflightValidatorFinalResult,
    formatGenericFinalResult,
    formatNodeConfigDesignerFinalResult,
} from '../agent/final-result-formatters';
import { AgentError } from '../errors/agent-error';
import {
    buildCustomerSupportPlan,
    buildFlowDesignerPlan,
    buildFlowPreflightValidatorPlan,
    buildNodeConfigDesignerPlan,
    buildOpsAutomationPlan,
    buildResearchBriefPlan,
} from './fake-plan-builders';
import { buildDeterministicReflectorOutput } from './fake-reflectors';
import type { LlmGateway, PlannerInput, ReflectorInput, FinalizerInput, StructuredGenerationInput } from './types';
import type { Plan } from '../agent/schemas';
import type { FinalResult, StepResult } from '../agent/types';
import { DeterministicFlowDesignTaskGraphAdvisor, getFlowDesignTaskGraphCatalog } from '../flow/design/task-graphs';
import { DeterministicFlowDesignTaskTypeAdvisor, getFlowDesignTaskTypeCatalog } from '../flow/design/task-types';

/** Deterministic gateway that returns stable plans and summaries for tests and demos. */
export class FakeLlmGateway implements LlmGateway {
    async plan(input: PlannerInput): Promise<Plan> {
        const availableToolNames = new Set(input.toolManifests.map(tool => tool.name));

        const ensureToolAvailable = (toolName: string) => {
            if (!availableToolNames.has(toolName)) {
                throw new Error(`Fake planner attempted unavailable tool: ${toolName}`);
            }
            return toolName;
        };

        if (input.skillName === 'research-brief-generator') {
            return await buildResearchBriefPlan(input, ensureToolAvailable);
        }

        if (input.skillName === 'ops-automation-agent') {
            return await buildOpsAutomationPlan(ensureToolAvailable);
        }

        if (input.skillName === 'flow-preflight-validator') {
            return await buildFlowPreflightValidatorPlan(input, ensureToolAvailable);
        }

        if (input.skillName === 'node-config-designer') {
            return await buildNodeConfigDesignerPlan();
        }

        if (input.skillName === 'flow-designer') {
            return await buildFlowDesignerPlan(input, ensureToolAvailable);
        }
        return await buildCustomerSupportPlan(input, ensureToolAvailable);
    }

    async reflect(input: ReflectorInput) {
        return buildDeterministicReflectorOutput(input);
    }

    async generateStructured<TSchema extends z.ZodTypeAny>(
        request: StructuredGenerationInput<TSchema>,
    ): Promise<z.output<TSchema>> {
        const userPayload = JSON.parse(request.input.find(message => message.role === 'user')?.content ?? '{}');

        if (request.schema.name === 'flow_design_task_type_classification') {
            const recommendation = await new DeterministicFlowDesignTaskTypeAdvisor().recommend({
                userRequest: String(userPayload.userRequest ?? ''),
                wantsJson: Boolean(userPayload.wantsJson),
                taskTypes: userPayload.taskTypes ?? (await getFlowDesignTaskTypeCatalog()),
            });
            return request.schema.parse({
                kind: 'task-type',
                taskType: recommendation.taskType,
                confidence: recommendation.confidence,
                rationale: recommendation.rationale,
            });
        }

        if (request.schema.name === 'flow_design_task_graph_classification') {
            const recommendation = await new DeterministicFlowDesignTaskGraphAdvisor().recommend({
                userRequest: String(userPayload.userRequest ?? ''),
                templates: userPayload.templates ?? (await getFlowDesignTaskGraphCatalog()),
            });
            return request.schema.parse({
                kind: 'task-graph',
                templateId: recommendation.templateId,
                confidence: recommendation.confidence,
                rationale: recommendation.rationale,
            });
        }

        if (request.schema.name === 'prompt_lab_self_review') {
            return request.schema.parse({
                summary: 'The run completed and produced enough signal to refine the operating prompt.',
                strengths: ['Captured execution output and persisted the run artifacts.'],
                weaknesses: ['Tighten instructions around evaluation criteria and retry behavior.'],
                improvements: ['Ask the agent to validate output quality before finalizing.'],
                recommendedPromptFocus: ['execution logging', 'self-review criteria', 'user-feedback incorporation'],
            });
        }

        if (request.schema.name === 'prompt_lab_codex_prompt') {
            return request.schema.parse({
                title: 'Codex Prompt Draft',
                summary: 'A synthesized Codex prompt built from run output, self-review, and user feedback.',
                codexPrompt: [
                    'You are Codex operating a flow-design improvement loop.',
                    'Record execution artifacts, state assumptions, and review results before finalizing.',
                    'Incorporate explicit operator feedback into the next revision plan.',
                ].join('\n'),
                usageNotes: ['Use this prompt as the next working Codex prompt for follow-up tasks.'],
            });
        }

        throw new AgentError(`Fake gateway does not support generic structured schema: ${request.schema.name}`, {
            code: 'FAKE_GATEWAY_UNSUPPORTED_STRUCTURED_SCHEMA',
        });
    }

    async finalize(input: FinalizerInput): Promise<FinalResult> {
        const stepResults = input.stepResults as StepResult[];

        if (input.skillName === 'flow-preflight-validator') {
            return formatFlowPreflightValidatorFinalResult(stepResults);
        }

        if (input.skillName === 'node-config-designer') {
            return await formatNodeConfigDesignerFinalResult();
        }

        if (input.skillName === 'flow-designer') {
            return await formatFlowDesignerFinalResult(stepResults);
        }

        return await formatGenericFinalResult(input.skillName, stepResults);
    }
}
