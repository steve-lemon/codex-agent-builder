// Vitest specs for the product-facing flow design facade.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowDesignProduct } from './flow-design-product';

describe('FlowDesignProduct', () => {
    beforeEach(() => {
        vi.stubEnv('LLM_PROVIDER', 'fake');
        vi.stubEnv('USE_REAL_OPENAI', 'false');
        vi.stubEnv('USE_REAL_GEMINI', 'false');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('runs explicit preflight without relying on selector wording', async () => {
        const product = new FlowDesignProduct();
        const result = await product.preflight('이메일을 확인해서 답장 해줘');

        expect(result.skillName).toBe('flow-preflight-validator');
        expect(result.preflightPayload).toEqual(
            expect.objectContaining({
                feasible: false,
                missingCapabilities: expect.arrayContaining(['email-read', 'email-reply']),
            }),
        );
        expect(result.flowDesign.feasible).toBe(false);
    });

    it('runs explicit flow design and returns normalized DTOs and payloads', async () => {
        const product = new FlowDesignProduct();
        const result = await product.design('키워드를 줄테니 블로그 타이틀 여러개 만들기');

        expect(result.skillName).toBe('flow-designer');
        expect(result.flowDesignerPayload).toEqual(
            expect.objectContaining({
                feasible: true,
                designPassCount: 3,
            }),
        );
        expect(result.requirementAssessment).toEqual(
            expect.objectContaining({
                executionSucceeded: true,
                fulfillmentLevel: expect.stringMatching(/fulfilled|uncertain/),
                summary: expect.any(String),
                reasons: expect.any(Array),
            }),
        );
        if (result.requirementAssessment.fulfillmentLevel !== 'fulfilled') {
            expect(result.summary).toContain('Current requirement assessment');
        }
        expect(result.flowDesign.designPassCount).toBe(3);
        expect(result.nodeConfiguration.configuredNodeCount).toBeGreaterThanOrEqual(3);
        expect(result.finalFlow?.nodes.some(node => node.blockId === 'ai-generate')).toBe(true);
        expect(result.finalFlow?.nodes.every(node => node.blockId !== 'text-processor')).toBe(true);
        const aiNode = result.finalFlow?.nodes.find(node => node.id === 'ai-node');
        expect(aiNode?.config).toEqual(
            expect.objectContaining({
                systemPrompt: expect.any(String),
                promptTemplate: expect.any(String),
            }),
        );
    });

    it('marks synthetic graph-sample validation as uncertain instead of fulfilled', async () => {
        const product = new FlowDesignProduct();
        const result = await product.design('그래프(json)를 보고 이게 뭐하는 것인지 설명(md) 해줘');

        expect(result.requirementAssessment.executionSucceeded).toBe(true);
        expect(result.requirementAssessment.fulfillmentLevel).toBe('uncertain');
        expect(result.requirementAssessment.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: 'synthetic-sample-validation',
                }),
            ]),
        );
    });

    it('still marks graph explanation as uncertain when the request does not include concrete graph json', async () => {
        const product = new FlowDesignProduct();
        const result = await product.design('그래프(json)를 보고 이게 뭐하는 것인지 설명(md) 해줘');

        expect(result.requirementAssessment.fulfillmentLevel).toBe('uncertain');
        expect(result.requirementAssessment.caveats).toEqual(
            expect.arrayContaining(['Validation relied on a synthetic sample input (synthetic-graph-json).']),
        );
    });

    it('avoids a generic task-graph fallback for count-oriented requests', async () => {
        const product = new FlowDesignProduct();
        const result = await product.design('엽력의 자소를 분리한 카운트 보여줘');

        expect(result.requirementAssessment.reasons.some(reason => reason.code === 'generic-task-graph-fallback')).toBe(
            false,
        );
        expect(result.requirementAssessment.caveats.some(note => note.includes('Task-graph fallback'))).toBe(false);
    });

    it('streams monitoring hooks through a per-call runtime', async () => {
        const product = new FlowDesignProduct();
        const designEvents: string[] = [];
        const timelineEvents: string[] = [];

        const result = await product.design('키워드를 줄테니 블로그 타이틀 여러개 만들기', {
            onDesignEvent(event) {
                designEvents.push(event.type);
            },
            onTimelineEvent(event) {
                timelineEvents.push(event.type);
            },
        });

        expect(result.status).toBe('completed');
        expect(designEvents).toContain('graph_started');
        expect(designEvents).toContain('graph_completed');
        expect(timelineEvents).toContain('skill_selected');
        expect(timelineEvents).toContain('graph_started');
    });

    it('runs explicit node-config design flow', async () => {
        const product = new FlowDesignProduct();
        const result = await product.designNodeConfiguration('ai 노드의 시스템 프롬프트와 모델 설정을 디자인해줘');

        expect(result.skillName).toBe('node-config-designer');
        expect(result.nodeConfigPayload).toEqual(
            expect.objectContaining({
                requiresExistingFlowDraft: true,
            }),
        );
        expect(result.nodeConfiguration.improvements).toEqual(
            expect.arrayContaining([expect.stringContaining('block-specific strategies')]),
        );
    });
});
