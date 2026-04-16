// Vitest specs for deterministic fake plan builders.
import { describe, expect, it } from 'vitest';
import {
    buildCustomerSupportPlan,
    buildFlowDesignerPlan,
    buildFlowPreflightValidatorPlan,
    buildNodeConfigDesignerPlan,
    buildOpsAutomationPlan,
    buildResearchBriefPlan,
} from './fake-plan-builders';
import type { PlannerInput } from './types';

const baseInput: PlannerInput = {
    userInput: 'default request',
    skillName: 'customer-support-reviewer',
    skillInstructions: 'skill',
    allowedTools: [],
    toolManifests: [],
    toolDefinitions: [],
};

function buildEnsureToolAvailable(...toolNames: string[]) {
    const available = new Set(toolNames);
    return (toolName: string) => {
        if (!available.has(toolName)) {
            throw new Error(`missing tool: ${toolName}`);
        }
        return toolName;
    };
}

describe('fake plan builders', () => {
    it('builds the research plan', () => {
        const plan = buildResearchBriefPlan(
            { ...baseInput, skillName: 'research-brief-generator', userInput: 'research topic' },
            buildEnsureToolAvailable('webSearch'),
        );

        expect(plan.steps).toHaveLength(3);
        expect(plan.steps[0]).toEqual(
            expect.objectContaining({
                mode: 'single-tool',
                toolCalls: [{ toolName: 'webSearch', args: { query: 'research topic' } }],
            }),
        );
    });

    it('builds the preflight validator plan with step references', () => {
        const plan = buildFlowPreflightValidatorPlan(
            { ...baseInput, skillName: 'flow-preflight-validator', userInput: '이메일 검증' },
            buildEnsureToolAvailable(
                'inferTaskGraph',
                'analyzeTaskGraphCompatibility',
                'proposeMissingBlocks',
                'prevalidateFlowDesignRequest',
            ),
        );

        expect(plan.steps).toHaveLength(5);
        expect(plan.steps[1]).toEqual(
            expect.objectContaining({
                toolCalls: [
                    expect.objectContaining({
                        args: {
                            taskGraph: { $fromStep: 's1', path: 'toolResults.0.data.taskGraph' },
                        },
                    }),
                ],
            }),
        );
    });

    it('builds the node-config designer plan', () => {
        const plan = buildNodeConfigDesignerPlan();
        expect(plan.steps).toHaveLength(2);
        expect(plan.steps[0]).toEqual(
            expect.objectContaining({
                mode: 'reasoning',
            }),
        );
    });

    it('builds an infeasible flow-designer plan for missing-capability requests', () => {
        const plan = buildFlowDesignerPlan(
            { ...baseInput, skillName: 'flow-designer', userInput: '이메일을 확인해서 답장 해줘' },
            buildEnsureToolAvailable('analyzeFlowRequest', 'prevalidateFlowDesignRequest'),
        );

        expect(plan.steps).toHaveLength(4);
        expect(plan.steps[2]).toEqual(expect.objectContaining({ mode: 'reasoning' }));
    });

    it('builds a multi-pass flow-designer plan for richer requests', () => {
        const plan = buildFlowDesignerPlan(
            { ...baseInput, skillName: 'flow-designer', userInput: '키워드로 블로그 제목 여러개를 json으로 만들어줘' },
            buildEnsureToolAvailable(
                'analyzeFlowRequest',
                'prevalidateFlowDesignRequest',
                'probeFlowBlock',
                'designFlowDraft',
                'designFlowNodeConfigurations',
                'validateFlowNodeConfigurations',
                'validateFlowDraft',
                'runFlowSample',
                'reflectFlowResult',
                'refineTaskGraph',
            ),
        );

        expect(plan.steps.some(step => step.description.includes('revision 1'))).toBe(true);
        expect(plan.steps.some(step => step.description.includes('revision 2'))).toBe(true);
        expect(plan.steps[plan.steps.length - 1]).toEqual(expect.objectContaining({ mode: 'finalize' }));
    });

    it('builds the default customer-support plan', () => {
        const plan = buildCustomerSupportPlan(
            { ...baseInput, userInput: 'please refund this order' },
            buildEnsureToolAvailable('getCustomerById', 'getOrdersByCustomer', 'getRefundPolicy', 'refundOrder'),
        );

        expect(plan.steps[0]).toEqual(expect.objectContaining({ mode: 'parallel-tools' }));
        expect(plan.steps.some(step => JSON.stringify(step).includes('"refundOrder"'))).toBe(true);
    });

    it('builds the ops automation plan', () => {
        const plan = buildOpsAutomationPlan(
            buildEnsureToolAvailable('getRefundPolicy', 'webSearch', 'sendSlackMessage'),
        );
        expect(plan.steps).toHaveLength(3);
        expect(plan.steps[1]).toEqual(
            expect.objectContaining({
                toolCalls: [expect.objectContaining({ toolName: 'sendSlackMessage' })],
            }),
        );
    });
});
