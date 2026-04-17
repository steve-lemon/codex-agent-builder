// Vitest specs for lightweight classifier adapters used by flow-design advisors.
import { describe, expect, it } from 'vitest';
import { createTaskGraphModelFromClassifier, createTaskTypeModelFromClassifier } from './model-adapters';
import { ModelBackedFlowDesignTaskGraphAdvisor, getFlowDesignTaskGraphCatalog } from './task-graphs';
import { ModelBackedFlowDesignTaskTypeAdvisor, getFlowDesignTaskTypeCatalog } from './task-types';

describe('flow-design model adapters', () => {
    it('adapts a lightweight classifier into a task-type model', async () => {
        const advisor = new ModelBackedFlowDesignTaskTypeAdvisor(
            createTaskTypeModelFromClassifier({
                async classifyTaskType() {
                    return {
                        taskType: 'json-generation',
                        confidence: 0.82,
                        rationale: 'Lightweight classifier preferred the JSON generation path.',
                    };
                },
            }),
        );

        const recommendation = await advisor.recommend({
            userRequest: '상품 소개 문구를 JSON 형태로 여러개 만들어줘',
            wantsJson: true,
            taskTypes: await getFlowDesignTaskTypeCatalog(),
        });

        expect(recommendation).toEqual(
            expect.objectContaining({
                taskType: 'json-generation',
                source: 'model',
                confidence: 0.82,
            }),
        );
    });

    it('adapts a lightweight classifier into a task-graph model', async () => {
        const advisor = new ModelBackedFlowDesignTaskGraphAdvisor(
            createTaskGraphModelFromClassifier({
                async classifyTaskGraph() {
                    return {
                        templateId: 'blog-title-generation',
                        confidence: 0.84,
                        rationale: 'Lightweight classifier selected the title generation workflow.',
                    };
                },
            }),
        );

        const recommendation = await advisor.recommend({
            userRequest: '키워드를 줄테니 블로그 타이틀 여러개 만들기',
            templates: await getFlowDesignTaskGraphCatalog(),
        });

        expect(recommendation).toEqual(
            expect.objectContaining({
                templateId: 'blog-title-generation',
                source: 'model',
                confidence: 0.84,
            }),
        );
    });

    it('returns an empty adapter result when a classifier capability is omitted', async () => {
        const taskTypeModel = createTaskTypeModelFromClassifier({});
        const taskGraphModel = createTaskGraphModelFromClassifier({});

        await expect(
            taskTypeModel.classify({
                userRequest: '짧은 소개 문구 만들어줘',
                wantsJson: false,
                taskTypes: await getFlowDesignTaskTypeCatalog(),
            }),
        ).resolves.toEqual(
            expect.objectContaining({
                taskType: '',
            }),
        );
        await expect(
            taskGraphModel.classify({
                userRequest: '짧은 소개 문구 만들어줘',
                templates: await getFlowDesignTaskGraphCatalog(),
            }),
        ).resolves.toEqual(
            expect.objectContaining({
                templateId: '',
            }),
        );
    });
});
