// Vitest specs for task-graph recommendation used by flow-design preflight analysis.
import { describe, expect, it } from 'vitest';
import { deriveRequiredCapabilitiesFromTaskGraph, inferTaskGraph } from './analysis';
import {
    DeterministicFlowDesignTaskGraphAdvisor,
    LlmBackedFlowDesignTaskGraphAdvisor,
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

    it('prefers a counting workflow over generic generation for count-oriented requests', async () => {
        const templates = await getFlowDesignTaskGraphCatalog();
        const advisor = new DeterministicFlowDesignTaskGraphAdvisor();

        const recommendation = await advisor.recommend({
            userRequest: '입력의 자소를 분리한 카운트 보여줘',
            templates,
            taskType: 'text-counting',
            operationModel: ['count', 'transform'],
        });

        expect(recommendation.templateId).toBe('text-counting');
        expect(recommendation.source).toBe('deterministic');
    });

    it('prefers a text editing workflow for email-style proofreading requests without mailbox intent', async () => {
        const templates = await getFlowDesignTaskGraphCatalog();
        const advisor = new DeterministicFlowDesignTaskGraphAdvisor();

        const recommendation = await advisor.recommend({
            userRequest: '이메일 내용의 오타를 정정해주기',
            templates,
            taskType: 'text-editing',
            operationModel: ['edit', 'transform'],
        });

        expect(recommendation.templateId).toBe('text-editing');
        expect(recommendation.graph.nodes.map(node => node.id)).toEqual([
            'capture-request',
            'revise-text',
            'review-output',
        ]);
        expect(recommendation.source).toBe('deterministic');
    });

    it('prefers a summarization workflow over title generation for three-line summary requests', async () => {
        const templates = await getFlowDesignTaskGraphCatalog();
        const advisor = new DeterministicFlowDesignTaskGraphAdvisor();

        const recommendation = await advisor.recommend({
            userRequest: '블로그 내용을 줄테니 이걸 3줄로 요약해줘',
            templates,
            taskType: 'text-summarization',
            operationModel: ['summarize', 'transform'],
        });

        expect(recommendation.templateId).toBe('text-summarization');
        expect(recommendation.graph.nodes.map(node => node.id)).toEqual([
            'capture-request',
            'summarize-content',
            'review-output',
        ]);
        expect(recommendation.source).toBe('deterministic');
    });

    it('prefers a keyword analysis workflow over summarization for keyword extraction requests', async () => {
        const templates = await getFlowDesignTaskGraphCatalog();
        const advisor = new DeterministicFlowDesignTaskGraphAdvisor();

        const recommendation = await advisor.recommend({
            userRequest: '블로그 내용을 줄테니 키워드 분석 해줘',
            templates,
            taskType: 'keyword-analysis',
            operationModel: ['extract', 'classify', 'transform'],
        });

        expect(recommendation.templateId).toBe('keyword-analysis');
        expect(recommendation.graph.nodes.map(node => node.id)).toEqual([
            'capture-request',
            'extract-keywords',
            'review-output',
        ]);
        expect(recommendation.source).toBe('deterministic');
    });

    it('prefers a text analysis workflow over graph explanation for error log diagnosis requests', async () => {
        const templates = await getFlowDesignTaskGraphCatalog();
        const advisor = new DeterministicFlowDesignTaskGraphAdvisor();

        const recommendation = await advisor.recommend({
            userRequest: '에러 로그를 보고 문제점 파악해',
            templates,
            taskType: 'text-analysis',
            operationModel: ['diagnose', 'extract', 'transform'],
            semanticFacets: {
                subject: 'log-data',
                inputShape: 'log-text',
                preferredTemplateTraits: ['analysis-workflow', 'diagnostic-analysis'],
                disallowedTemplateTraits: ['graph-structured-input', 'title-generation'],
            },
        });

        expect(recommendation.templateId).toBe('text-analysis');
        expect(recommendation.graph.nodes.map(node => node.id)).toEqual([
            'capture-request',
            'analyze-content',
            'review-output',
        ]);
        expect(recommendation.source).toBe('deterministic');
    });

    it('uses a model-backed task-graph advisor when one is supplied', async () => {
        const gateway = {
            generateStructured: async () => ({
                kind: 'task-graph' as const,
                templateId: 'generic-generation',
                confidence: 0.88,
                rationale: 'Model selected the generic generation workflow.',
            }),
        } as any;
        const graph = await inferTaskGraph('짧은 소개 문구 만들어줘', {
            taskGraphAdvisor: new LlmBackedFlowDesignTaskGraphAdvisor(gateway),
            taskGraphTemplates: await getFlowDesignTaskGraphCatalog(),
        });

        expect(graph.nodes.map(node => node.id)).toEqual(['capture-request', 'generate-output', 'review-output']);
    });

    it('falls back to deterministic graph classification when a model returns an unknown template', async () => {
        const templates = await getFlowDesignTaskGraphCatalog();
        const advisor = new LlmBackedFlowDesignTaskGraphAdvisor(
            {
                async generateStructured() {
                    return {
                        kind: 'task-graph' as const,
                        templateId: 'does-not-exist',
                    };
                },
            } as any,
            new DeterministicFlowDesignTaskGraphAdvisor(),
        );

        const recommendation = await advisor.recommend({
            userRequest: '키워드를 줄테니 블로그 타이틀 여러개 만들기',
            templates,
        });

        expect(recommendation.templateId).toBe('blog-title-generation');
        expect(recommendation.source).toBe('deterministic');
    });

    it('falls back to deterministic graph classification when lite confidence is below the advisor threshold', async () => {
        const templates = await getFlowDesignTaskGraphCatalog();
        const advisor = new LlmBackedFlowDesignTaskGraphAdvisor(
            {
                async generateStructured() {
                    return {
                        kind: 'task-graph' as const,
                        templateId: 'email-reply',
                        confidence: 0.2,
                    };
                },
            } as any,
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
            'ai-generation',
            'text-output',
            'email-reply',
        ]);
    });

    it('does not infer email transport capabilities for email-content proofreading requests', async () => {
        const graph = await inferTaskGraph('이메일 내용의 오타를 정정해주기', {
            taskType: 'text-editing',
            operationModel: ['edit', 'transform'],
        });

        expect(deriveRequiredCapabilitiesFromTaskGraph(graph)).toEqual(['text-input', 'ai-generation', 'text-output', 'view-log']);
        expect(graph.nodes.map(node => node.id)).toEqual(['capture-request', 'revise-text', 'review-output']);
    });

    it('does not reuse blog title capabilities for summarization requests', async () => {
        const graph = await inferTaskGraph('블로그 내용을 줄테니 이걸 3줄로 요약해줘', {
            taskType: 'text-summarization',
            operationModel: ['summarize', 'transform'],
        });

        expect(deriveRequiredCapabilitiesFromTaskGraph(graph)).toEqual(['text-input', 'ai-generation', 'text-output', 'view-log']);
        expect(graph.nodes.map(node => node.id)).toEqual(['capture-request', 'summarize-content', 'review-output']);
    });

    it('does not reuse summarization semantics for keyword analysis requests', async () => {
        const graph = await inferTaskGraph('블로그 내용을 줄테니 키워드 분석 해줘', {
            taskType: 'keyword-analysis',
            operationModel: ['extract', 'classify', 'transform'],
        });

        expect(deriveRequiredCapabilitiesFromTaskGraph(graph)).toEqual(['text-input', 'ai-generation', 'text-output', 'view-log']);
        expect(graph.nodes.map(node => node.id)).toEqual(['capture-request', 'extract-keywords', 'review-output']);
    });

    it('does not treat error log diagnosis as graph explanation when graph structure is disallowed', async () => {
        const graph = await inferTaskGraph('에러 로그를 보고 문제점 파악해', {
            taskType: 'text-analysis',
            operationModel: ['diagnose', 'extract', 'transform'],
            semanticFacets: {
                subject: 'log-data',
                inputShape: 'log-text',
                preferredTemplateTraits: ['analysis-workflow', 'diagnostic-analysis'],
                disallowedTemplateTraits: ['graph-structured-input', 'title-generation'],
            },
        });

        expect(deriveRequiredCapabilitiesFromTaskGraph(graph)).toEqual(['text-input', 'ai-generation', 'text-output', 'view-log']);
        expect(graph.nodes.map(node => node.id)).toEqual(['capture-request', 'analyze-content', 'review-output']);
    });
});
