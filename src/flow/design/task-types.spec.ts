// Vitest specs for task-type recommendation used by flow-design intent analysis.
import { describe, expect, it } from 'vitest';
import { analyzeFlowRequest } from './core';
import {
    DeterministicFlowDesignTaskTypeAdvisor,
    ModelBackedFlowDesignTaskTypeAdvisor,
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
        const intent = await analyzeFlowRequest('간단한 소개 문구 만들어줘', {
            taskTypeAdvisor: new ModelBackedFlowDesignTaskTypeAdvisor({
                async classify() {
                    return {
                        taskType: 'text-generation',
                        confidence: 0.91,
                        rationale: 'Model selected the general text generation task type.',
                    };
                },
            }),
            taskTypes: await getFlowDesignTaskTypeCatalog(),
        });

        expect(intent.taskType).toBe('text-generation');
        expect(intent.taskTypeSource).toBe('model');
        expect(intent.taskTypeConfidence).toBe(0.91);
        expect(intent.taskTypeRationale).toContain('Model selected');
    });

    it('falls back to deterministic classification when a model returns an unknown task type', async () => {
        const taskTypes = await getFlowDesignTaskTypeCatalog();
        const advisor = new ModelBackedFlowDesignTaskTypeAdvisor(
            {
                async classify() {
                    return {
                        taskType: 'made-up-task',
                    };
                },
            },
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
});
