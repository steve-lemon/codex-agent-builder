// LLM gateway interfaces and implementations.
import {
    formatFlowDesignerFinalResult,
    formatFlowPreflightValidatorFinalResult,
    formatGenericFinalResult,
    formatNodeConfigDesignerFinalResult,
} from '../agent/final-result-formatters';
import {
    buildCustomerSupportPlan,
    buildFlowDesignerPlan,
    buildFlowPreflightValidatorPlan,
    buildNodeConfigDesignerPlan,
    buildOpsAutomationPlan,
    buildResearchBriefPlan,
} from './fake-plan-builders';
import { buildDeterministicReflectorOutput } from './fake-reflectors';
import type { LlmGateway, PlannerInput, ReflectorInput, FinalizerInput } from './types';
import type { Plan } from '../agent/schemas';
import type { FinalResult, StepResult } from '../agent/types';

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
