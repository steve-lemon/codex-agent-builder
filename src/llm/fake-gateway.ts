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
import { defaultFlowAiDelegationAdvisor } from '../flow/design/ai-delegation';
import { inferFlowOutputContract } from '../flow/output-contract';

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
            const catalog = await getFlowDesignTaskTypeCatalog();
            const shortlistedTaskTypeIds = Array.isArray(userPayload.taskTypes)
                ? userPayload.taskTypes
                      .map((taskType: { id?: unknown }) =>
                          typeof taskType?.id === 'string' ? taskType.id : undefined,
                      )
                      .filter((id: string | undefined): id is string => Boolean(id))
                : [];
            const recommendation = await new DeterministicFlowDesignTaskTypeAdvisor().recommend({
                userRequest: String(userPayload.userRequest ?? ''),
                wantsJson: Boolean(userPayload.wantsJson),
                taskTypes:
                    shortlistedTaskTypeIds.length > 0
                        ? catalog.filter(taskType => shortlistedTaskTypeIds.includes(taskType.id))
                        : catalog,
            });
            return request.schema.parse({
                taskType: recommendation.taskType,
                confidence: recommendation.confidence,
                rationale: recommendation.rationale,
            });
        }

        if (request.schema.name === 'flow_design_task_graph_classification') {
            const catalog = await getFlowDesignTaskGraphCatalog();
            const shortlistedTemplateIds = Array.isArray(userPayload.templates)
                ? userPayload.templates
                      .map((template: { id?: unknown }) => (typeof template?.id === 'string' ? template.id : undefined))
                      .filter((id: string | undefined): id is string => Boolean(id))
                : [];
            const recommendation = await new DeterministicFlowDesignTaskGraphAdvisor().recommend({
                userRequest: String(userPayload.userRequest ?? ''),
                templates:
                    shortlistedTemplateIds.length > 0
                        ? catalog.filter(template => shortlistedTemplateIds.includes(template.id))
                        : catalog,
            });
            return request.schema.parse({
                templateId: recommendation.templateId,
                confidence: recommendation.confidence,
                rationale: recommendation.rationale,
            });
        }

        if (request.schema.name === 'flow_output_contract_classification') {
            const recommendation = inferFlowOutputContract(String(userPayload.userRequest ?? ''));
            return request.schema.parse({
                format: recommendation.format,
                explicitFormat: recommendation.explicitFormat,
                desiredCount: recommendation.desiredCount,
                rationale: 'Output contract matched the deterministic fallback heuristic.',
                confidence: 0.82,
            });
        }

        if (request.schema.name === 'flow_ai_delegation_classification') {
            const recommendation = await defaultFlowAiDelegationAdvisor.recommend({
                userRequest: String(userPayload.userRequest ?? ''),
                operation: String(userPayload.operation ?? ''),
                requiredCapabilities: userPayload.requiredCapabilities ?? [],
                expectedInputs: userPayload.expectedInputs ?? [],
                expectedOutputs: userPayload.expectedOutputs ?? [],
            });
            return request.schema.parse({
                delegable: recommendation.delegable,
                confidence: recommendation.confidence ?? 0.8,
                rationale: recommendation.rationale ?? 'Delegation decision matched the deterministic fallback heuristic.',
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

        if (request.schema.name === 'prompt_lab_codex_prompt_rewrite') {
            return request.schema.parse({
                title: 'Codex Prompt Draft',
                summary: 'A rewritten natural-language Codex prompt built from the generated draft and run output.',
                codexPrompt: [
                    '다음 요구사항을 만족하도록 작업하라.',
                    '입력과 출력 형식을 명확히 지키고, 결과 검증 조건을 함께 반영하라.',
                    '구현 코드나 예시 코드를 프롬프트 본문에 포함하지 말고, 자연어 작업 지시문으로 유지하라.',
                ].join('\n'),
                usageNotes: ['Use this rewritten prompt as the next working Codex prompt for follow-up tasks.'],
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
