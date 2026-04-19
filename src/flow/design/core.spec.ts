// Vitest specs for the shared flow-design core.
import { describe, expect, it } from 'vitest';
import { getCatalogAvailableFlowBlocks } from './catalog';
import {
    analyzeFlowRequest,
    designFlowDraft,
    executeFlowDesignSample,
    reflectFlowExecution,
    validateDesignedFlow,
} from './core';

describe('flow-design core', () => {
    it('analyzes a multi-result title request into reusable intent', async () => {
        const intent = await analyzeFlowRequest('키워드를 줄테니 블로그 타이틀 여러개 만들기');

        expect(intent).toEqual({
            userRequest: '키워드를 줄테니 블로그 타이틀 여러개 만들기',
            taskType: 'blog-title-generation',
            taskTypeConfidence: expect.any(Number),
            taskTypeRationale: expect.any(String),
            taskTypeSource: 'deterministic',
            outputContract: {
                format: 'unspecified',
                explicitFormat: false,
                desiredCount: 5,
                wantsMultiple: true,
                wantsJson: false,
            },
            wantsJson: false,
            wantsMultiple: true,
            desiredCount: 5,
            sampleInput: '생산성 향상',
            sampleInputSource: 'default',
            sampleInputReadyForDesign: true,
            designBrief: expect.objectContaining({
                mission: expect.objectContaining({
                    operationModel: expect.arrayContaining(['generate']),
                }),
                executionPosture: expect.objectContaining({
                    strategy: expect.any(String),
                }),
                validationPlan: expect.objectContaining({
                    sampleCases: expect.any(Array),
                    assertions: expect.any(Array),
                }),
            }),
        });
    });

    it('treats json input plus markdown explanation requests as plain-text output intent', async () => {
        const intent = await analyzeFlowRequest('그래프(json)를 보고 이게 뭐하는 것인지 설명(md) 해줘');

        expect(intent.taskType).toBe('graph-explanation');
        expect(intent.outputContract).toEqual({
            format: 'plain-text',
            explicitFormat: true,
            desiredCount: 1,
            wantsMultiple: false,
            wantsJson: false,
        });
        expect(intent.wantsJson).toBe(false);
        expect(intent.sampleInputSource).toBe('synthetic-graph-json');
        expect(intent.sampleInputReadyForDesign).toBe(true);
        expect(intent.sampleInput).toContain('"nodes"');
        expect(intent.sampleInput).toContain('"edges"');
        expect(intent.designBrief).toEqual(
            expect.objectContaining({
                inputContract: expect.objectContaining({
                    source: 'synthetic',
                }),
                validationPlan: expect.objectContaining({
                    confidenceCeiling: 'uncertain',
                }),
            }),
        );
    });

    it('creates and validates a deterministic draft flow from preflight-backed inputs', async () => {
        const availableFlowBlocks = await getCatalogAvailableFlowBlocks();
        const draft = await designFlowDraft({
            userRequest: '키워드를 줄테니 블로그 타이틀 여러개 만들기',
            sampleInput: '생산성 향상',
            desiredCount: 5,
            wantsJson: false,
            availableBlocks: availableFlowBlocks,
        });

        expect(draft.flow.nodes.map(node => node.id)).toEqual([
            'system-input',
            'prompt-input',
            'ai-node',
            'view-output',
        ]);
        expect(draft.taskGraphMapping.flowNodes).toEqual(
            expect.arrayContaining([expect.objectContaining({ flowNodeId: 'ai-node', taskNodeId: 'generate-titles' })]),
        );
        expect(validateDesignedFlow(draft.flow)).toEqual(
            expect.objectContaining({
                isValid: true,
                issues: [],
            }),
        );
    });

    it('recomputes feasibility when an infeasible preflight payload has no concrete missing capabilities', async () => {
        const availableFlowBlocks = await getCatalogAvailableFlowBlocks();

        const draft = await designFlowDraft({
            userRequest: '그래프(json)를 보고 이게 뭐하는 것인지 설명(md) 해줘',
            sampleInput: '{"nodes":[],"edges":[]}',
            desiredCount: 1,
            wantsJson: false,
            availableBlocks: availableFlowBlocks,
            preflight: {
                feasible: false,
                taskGraph: { nodes: [], edges: [] },
                nodeAnalyses: [],
                requiredCapabilities: [],
                availableCapabilities: [],
                missingCapabilities: [],
                proposedBlocks: [],
                reason: 'planner-inline-placeholder',
                recommendedAction: 'none',
            },
        });

        expect(draft.preflightSummary.feasible).toBe(true);
        expect(validateDesignedFlow(draft.flow)).toEqual(
            expect.objectContaining({
                isValid: true,
            }),
        );
    });

    it('executes and reflects on the shared draft flow without depending on tool wrappers', async () => {
        const availableFlowBlocks = await getCatalogAvailableFlowBlocks();
        const draft = await designFlowDraft({
            userRequest: '상품 소개 문구를 JSON 형태로 여러개 만들어줘',
            sampleInput: '샘플 입력',
            desiredCount: 5,
            wantsJson: true,
            availableBlocks: availableFlowBlocks,
        });

        const execution = await executeFlowDesignSample({
            flow: draft.flow,
            userRequest: '상품 소개 문구를 JSON 형태로 여러개 만들어줘',
            improvementNotes: [],
        });
        const reflection = await reflectFlowExecution({
            userRequest: '상품 소개 문구를 JSON 형태로 여러개 만들어줘',
            desiredCount: 5,
            wantsJson: true,
            sampleResult: {
                status: execution.status,
                output: execution.output,
                logs: execution.logs,
            },
        });

        expect(execution.status).toBe('completed');
        expect(execution.output).toMatchObject({
            model: 'fake-main',
            items: expect.any(Array),
        });
        expect(reflection.satisfied).toBe(true);
    });
});
