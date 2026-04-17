// Vitest specs for gateway-backed lightweight classifier providers used by flow-design advisors.
import { describe, expect, it, vi } from 'vitest';
import { createTaskGraphModelFromClassifier, createTaskTypeModelFromClassifier } from './model-adapters';
import { LlmGatewayFlowDesignClassifierProvider } from './classifier-provider';
import { ModelBackedFlowDesignTaskGraphAdvisor, getFlowDesignTaskGraphCatalog } from './task-graphs';
import { ModelBackedFlowDesignTaskTypeAdvisor, getFlowDesignTaskTypeCatalog } from './task-types';

describe('flow-design classifier providers', () => {
    it('classifies task types through the shared LLM gateway boundary', async () => {
        const gateway = {
            plan: vi.fn(),
            reflect: vi.fn(),
            finalize: vi.fn(),
            generateStructured: vi.fn(async () => ({
                kind: 'task-type' as const,
                taskType: 'blog-title-generation',
                confidence: 0.93,
                rationale: 'The request is clearly about blog title generation.',
            })),
        };
        const provider = new LlmGatewayFlowDesignClassifierProvider(gateway);
        const advisor = new ModelBackedFlowDesignTaskTypeAdvisor(createTaskTypeModelFromClassifier(provider));

        const recommendation = await advisor.recommend({
            userRequest: '키워드를 줄테니 블로그 타이틀 여러개 만들기',
            wantsJson: false,
            taskTypes: await getFlowDesignTaskTypeCatalog(),
        });

        expect(recommendation).toEqual(
            expect.objectContaining({
                taskType: 'blog-title-generation',
                source: 'model',
                confidence: 0.93,
            }),
        );
        expect(gateway.generateStructured).toHaveBeenCalledWith(
            expect.objectContaining({
                schema: expect.objectContaining({ name: 'flow_design_task_type_classification' }),
            }),
        );
    });

    it('classifies task graphs through the shared LLM gateway boundary', async () => {
        const gateway = {
            plan: vi.fn(),
            reflect: vi.fn(),
            finalize: vi.fn(),
            generateStructured: vi.fn(async () => ({
                kind: 'task-graph' as const,
                templateId: 'email-reply',
                confidence: 0.81,
                rationale: 'The request maps to the email reply workflow.',
            })),
        };
        const provider = new LlmGatewayFlowDesignClassifierProvider(gateway);
        const advisor = new ModelBackedFlowDesignTaskGraphAdvisor(createTaskGraphModelFromClassifier(provider));

        const recommendation = await advisor.recommend({
            userRequest: '이메일을 확인해서 답장 해줘',
            templates: await getFlowDesignTaskGraphCatalog(),
        });

        expect(recommendation).toEqual(
            expect.objectContaining({
                templateId: 'email-reply',
                source: 'model',
                confidence: 0.81,
            }),
        );
        expect(gateway.generateStructured).toHaveBeenCalledWith(
            expect.objectContaining({
                schema: expect.objectContaining({ name: 'flow_design_task_graph_classification' }),
            }),
        );
    });

    it('supports gateways that return both task-type and task-graph classifications', async () => {
        const gateway = {
            plan: vi.fn(),
            reflect: vi.fn(),
            finalize: vi.fn(),
            generateStructured: vi.fn(async (input: { schema: { name: string } }) => {
                return input.schema.name === 'flow_design_task_type_classification'
                    ? ({ kind: 'task-type', taskType: 'text-generation', confidence: 0.78 } as const)
                    : ({ kind: 'task-graph', templateId: 'generic-generation', confidence: 0.79 } as const);
            }),
        };
        const provider = new LlmGatewayFlowDesignClassifierProvider(gateway);

        await expect(
            provider.classifyTaskType?.({
                userRequest: '짧은 소개 문구 만들어줘',
                wantsJson: false,
                taskTypes: await getFlowDesignTaskTypeCatalog(),
            }),
        ).resolves.toEqual(
            expect.objectContaining({
                taskType: 'text-generation',
            }),
        );
        await expect(
            provider.classifyTaskGraph?.({
                userRequest: '짧은 소개 문구 만들어줘',
                templates: await getFlowDesignTaskGraphCatalog(),
            }),
        ).resolves.toEqual(
            expect.objectContaining({
                templateId: 'generic-generation',
            }),
        );
        expect(gateway.generateStructured).toHaveBeenCalledTimes(2);
    });
});
