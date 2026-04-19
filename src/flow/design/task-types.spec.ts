// Vitest specs for task-type recommendation used by flow-design intent analysis.
import { describe, expect, it } from 'vitest';
import { analyzeFlowRequest } from './core';
import {
    DeterministicFlowDesignTaskTypeAdvisor,
    LlmBackedFlowDesignTaskTypeAdvisor,
    getFlowDesignTaskTypeCatalog,
} from './task-types';

describe('flow-design task type advisors', () => {
    it('classifies blog title requests using the internal task-type catalog', async () => {
        const taskTypes = await getFlowDesignTaskTypeCatalog();
        const advisor = new DeterministicFlowDesignTaskTypeAdvisor();

        const recommendation = await advisor.recommend({
            userRequest: '키워드를 줄테니 블로그 타이틀 여러개 만들기',
            wantsJson: false,
            taskTypes,
        });

        expect(recommendation.taskType).toBe('blog-title-generation');
        expect(recommendation.source).toBe('deterministic');
        expect(recommendation.confidence).toBeGreaterThan(0.5);
    });

    it('uses a model-backed advisor when one is supplied', async () => {
        const gateway = {
            generateStructured: async () => ({
                kind: 'task-type' as const,
                taskType: 'text-generation',
                confidence: 0.91,
                rationale: 'Model selected the general text generation task type.',
            }),
        } as any;
        const intent = await analyzeFlowRequest('간단한 소개 문구 만들어줘', {
            taskTypeAdvisor: new LlmBackedFlowDesignTaskTypeAdvisor(gateway),
            taskTypes: await getFlowDesignTaskTypeCatalog(),
        });

        expect(intent.taskType).toBe('text-generation');
        expect(intent.taskTypeSource).toBe('model');
        expect(intent.taskTypeConfidence).toBe(0.91);
        expect(intent.taskTypeRationale).toContain('Model selected');
    });

    it('falls back to deterministic classification when a model returns an unknown task type', async () => {
        const taskTypes = await getFlowDesignTaskTypeCatalog();
        const advisor = new LlmBackedFlowDesignTaskTypeAdvisor(
            {
                async generateStructured() {
                    return {
                        kind: 'task-type' as const,
                        taskType: 'made-up-task',
                    };
                },
            } as any,
            new DeterministicFlowDesignTaskTypeAdvisor(),
        );

        const recommendation = await advisor.recommend({
            userRequest: '상품 소개 문구를 JSON 형태로 여러개 만들어줘',
            wantsJson: true,
            taskTypes,
        });

        expect(recommendation.taskType).toBe('json-generation');
        expect(recommendation.source).toBe('deterministic');
    });

    it('falls back to deterministic classification when lite confidence is below the advisor threshold', async () => {
        const taskTypes = await getFlowDesignTaskTypeCatalog();
        const advisor = new LlmBackedFlowDesignTaskTypeAdvisor(
            {
                async generateStructured() {
                    return {
                        kind: 'task-type' as const,
                        taskType: 'blog-title-generation',
                        confidence: 0.3,
                    };
                },
            } as any,
            new DeterministicFlowDesignTaskTypeAdvisor(),
        );

        const recommendation = await advisor.recommend({
            userRequest: '상품 소개 문구를 JSON 형태로 여러개 만들어줘',
            wantsJson: true,
            taskTypes,
        });

        expect(recommendation.taskType).toBe('json-generation');
        expect(recommendation.source).toBe('deterministic');
    });

    it('classifies email-style proofreading requests as text editing instead of email integration', async () => {
        const taskTypes = await getFlowDesignTaskTypeCatalog();
        const advisor = new DeterministicFlowDesignTaskTypeAdvisor();

        const recommendation = await advisor.recommend({
            userRequest: '이메일 내용의 오타를 정정해주기',
            wantsJson: false,
            taskTypes,
        });

        expect(recommendation.taskType).toBe('text-editing');
        expect(recommendation.source).toBe('deterministic');
    });

    it('classifies summarization requests by operation instead of blog-title domain words', async () => {
        const taskTypes = await getFlowDesignTaskTypeCatalog();
        const advisor = new DeterministicFlowDesignTaskTypeAdvisor();

        const recommendation = await advisor.recommend({
            userRequest: '블로그 내용을 줄테니 이걸 3줄로 요약해줘',
            wantsJson: false,
            taskTypes,
        });

        expect(recommendation.taskType).toBe('text-summarization');
        expect(recommendation.source).toBe('deterministic');
    });

    it('classifies keyword analysis requests as extraction instead of summarization', async () => {
        const taskTypes = await getFlowDesignTaskTypeCatalog();
        const advisor = new DeterministicFlowDesignTaskTypeAdvisor();

        const recommendation = await advisor.recommend({
            userRequest: '블로그 내용을 줄테니 키워드 분석 해줘',
            wantsJson: false,
            taskTypes,
        });

        expect(recommendation.taskType).toBe('keyword-analysis');
        expect(recommendation.source).toBe('deterministic');
    });
});
