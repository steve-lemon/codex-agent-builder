// Vitest specs for task-graph recommendation used by flow-design preflight analysis.
import { describe, expect, it } from 'vitest';
import { deriveRequiredCapabilitiesFromTaskGraph, inferTaskGraph } from './analysis';
import {
    DeterministicFlowDesignTaskGraphAdvisor,
    ModelBackedFlowDesignTaskGraphAdvisor,
    getFlowDesignTaskGraphCatalog,
} from './task-graphs';

describe('flow-design task graph advisors', () => {
    it('classifies email reply requests into the email workflow graph', async () => {
        const templates = await getFlowDesignTaskGraphCatalog();
        const advisor = new DeterministicFlowDesignTaskGraphAdvisor();

        const recommendation = await advisor.recommend({
            userRequest: '이메일을 확인해서 답장 해줘',
            templates,
        });

        expect(recommendation.templateId).toBe('email-reply');
        expect(recommendation.graph.nodes.map(node => node.id)).toEqual(['email-read', 'draft-reply', 'send-reply']);
        expect(recommendation.source).toBe('deterministic');
    });

    it('uses a model-backed task-graph advisor when one is supplied', async () => {
        const graph = await inferTaskGraph('짧은 소개 문구 만들어줘', {
            taskGraphAdvisor: new ModelBackedFlowDesignTaskGraphAdvisor({
                async classify() {
                    return {
                        templateId: 'generic-generation',
                        confidence: 0.88,
                        rationale: 'Model selected the generic generation workflow.',
                    };
                },
            }),
            taskGraphTemplates: await getFlowDesignTaskGraphCatalog(),
        });

        expect(graph.nodes.map(node => node.id)).toEqual(['capture-request', 'generate-output', 'review-output']);
    });

    it('falls back to deterministic graph classification when a model returns an unknown template', async () => {
        const templates = await getFlowDesignTaskGraphCatalog();
        const advisor = new ModelBackedFlowDesignTaskGraphAdvisor(
            {
                async classify() {
                    return {
                        templateId: 'does-not-exist',
                    };
                },
            },
            new DeterministicFlowDesignTaskGraphAdvisor(),
        );

        const recommendation = await advisor.recommend({
            userRequest: '키워드를 줄테니 블로그 타이틀 여러개 만들기',
            templates,
        });

        expect(recommendation.templateId).toBe('blog-title-generation');
        expect(recommendation.source).toBe('deterministic');
    });

    it('derives required capabilities from the inferred task graph instead of request text heuristics', async () => {
        const graph = await inferTaskGraph('이메일을 확인해서 답장 해줘');

        expect(deriveRequiredCapabilitiesFromTaskGraph(graph)).toEqual([
            'email-read',
            'mock-ai-generation',
            'text-output',
            'email-reply',
        ]);
    });
});
