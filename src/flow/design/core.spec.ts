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
            wantsJson: false,
            wantsMultiple: true,
            desiredCount: 5,
            sampleInput: '생산성 향상',
        });
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
            model: 'mock-flow-model',
            items: expect.any(Array),
        });
        expect(reflection.satisfied).toBe(true);
    });
});
