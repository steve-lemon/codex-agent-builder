// Vitest specs for skill-specific final-result formatter helpers.
import { describe, expect, it } from 'vitest';
import {
    formatFlowDesignerFinalResult,
    formatFlowPreflightValidatorFinalResult,
    formatGenericFinalResult,
    formatNodeConfigDesignerFinalResult,
} from './final-result-formatters';
import type { StepResult } from './types';

function makeStepResult(stepId: string, toolName: string, data: unknown): StepResult {
    return {
        stepId,
        mode: 'single-tool',
        output: null,
        toolResults: [
            {
                toolName,
                ok: true,
                data,
            },
        ],
    };
}

describe('final-result formatters', () => {
    it('formats preflight-validator results from step outputs', () => {
        const result = formatFlowPreflightValidatorFinalResult([
            makeStepResult('s1', 'prevalidateFlowDesignRequest', {
                feasible: false,
                missingCapabilities: ['email-read'],
                proposedBlocks: [{ blockId: 'email-read-block' }],
            }),
        ]);

        expect(result.success).toBe(false);
        expect(result.summary).toContain('flow-preflight-validator');
        expect(result.payload).toEqual(
            expect.objectContaining({
                kind: 'flow-preflight-validator',
                missingCapabilities: ['email-read'],
            }),
        );
        expect(result.designDetails?.flowDesign?.feasible).toBe(false);
    });

    it('formats node-config-designer results without inspecting step outputs', async () => {
        const result = await formatNodeConfigDesignerFinalResult();

        expect(result.success).toBe(true);
        expect(result.payload).toEqual(
            expect.objectContaining({
                kind: 'node-config-designer',
                requiresExistingFlowDraft: true,
            }),
        );
        expect(result.designDetails?.nodeConfiguration?.improvements).toEqual(
            expect.arrayContaining([expect.stringContaining('graph structure is stable')]),
        );
    });

    it('formats successful flow-designer results from step outputs', async () => {
        const result = await formatFlowDesignerFinalResult([
            makeStepResult('s0', 'analyzeFlowRequest', {
                outputContract: {
                    format: 'json',
                    explicitFormat: true,
                    desiredCount: 1,
                    wantsMultiple: false,
                    wantsJson: true,
                },
            }),
            makeStepResult('s1', 'prevalidateFlowDesignRequest', {
                feasible: true,
                missingCapabilities: [],
            }),
            makeStepResult('s2', 'designFlowNodeConfigurations', {
                flow: {
                    nodes: [
                        {
                            blockId: 'ai-generate',
                            config: {
                                jsonOutput: 'false',
                                outputSchema: '',
                            },
                        },
                    ],
                },
                suggestions: [{ nodeId: 'ai-node' }],
                appliedStrategyIds: ['ai-generation'],
                nodeStrategyAssignments: [{ nodeId: 'ai-node', strategyId: 'ai-generation' }],
                probeInsightsApplied: ['Observed mock output'],
            }),
            makeStepResult('s3', 'reflectFlowResult', {
                satisfied: true,
                improvementNotes: ['Keep JSON mode enabled'],
                nodeConfigSkillImprovements: ['Strengthen AI strategy'],
            }),
            makeStepResult('s4', 'refineTaskGraph', {
                refined: true,
            }),
        ]);

        expect(result.success).toBe(true);
        expect(result.summary).toContain('executed successfully');
        expect(result.summary).toContain('satisfactory for the request');
        expect(result.summary).toContain('did not preserve the requested JSON output contract');
        expect(result.nextActions).toContain('Align the AI node output mode with the requested JSON contract.');
        expect(result.payload).toEqual(
            expect.objectContaining({
                kind: 'flow-designer',
                designPassCount: 1,
                taskGraphRefinementCount: 1,
                configuredNodeCount: 1,
                probeInsightCount: 1,
            }),
        );
        expect(result.designDetails?.flowDesign?.improvements).toEqual(['Keep JSON mode enabled']);
        expect(result.designDetails?.nodeConfiguration?.appliedStrategies).toEqual(['ai-generation']);
    });

    it('formats generic fallback results', async () => {
        const result = await formatGenericFinalResult('customer-support-reviewer', []);

        expect(result).toEqual(
            expect.objectContaining({
                success: true,
                summary: expect.stringContaining('customer-support-reviewer'),
                nextActions: ['Review trace logs if needed'],
            }),
        );
        expect(result.designDetails?.flowDesign).toBeDefined();
        expect(result.designDetails?.nodeConfiguration).toBeDefined();
    });
});
