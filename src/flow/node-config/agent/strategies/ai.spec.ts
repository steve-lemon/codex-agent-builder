// Vitest specs for the AI node configuration strategy.
import { describe, expect, it } from 'vitest';
import { AiGenerateNodeStrategy } from './ai';

describe('ai node strategy', () => {
    it('exposes the expected strategy id and validation rules', () => {
        const strategy = new AiGenerateNodeStrategy();

        expect(strategy.strategyId).toBe('ai-generation');
        expect(
            strategy.validate?.({
                id: 'ai-node',
                blockId: 'ai-generate',
                label: 'AI Node',
                config: {},
                inputPorts: [],
                outputPorts: [],
            }),
        ).toEqual(
            expect.arrayContaining([
                expect.stringContaining('model configuration'),
                expect.stringContaining('jsonOutput'),
                expect.stringContaining('systemPrompt'),
                expect.stringContaining('promptTemplate'),
            ]),
        );
    });

    it('populates fallback system and prompt config for the AI node', async () => {
        const strategy = new AiGenerateNodeStrategy();

        const result = await strategy.apply(
            {
                id: 'ai-node',
                blockId: 'ai-generate',
                label: 'AI Node',
                config: {},
                inputPorts: [],
                outputPorts: [],
            },
            {
                flow: { blocks: [], nodes: [], edges: [] },
                input: {
                    userRequest: '입력한 텍스트에서 자음 개수를 찾아서 JSON으로 보여줘',
                    flow: { blocks: [], nodes: [], edges: [] },
                    desiredCount: 1,
                    wantsJson: true,
                },
                probeInsightsApplied: [],
            },
        );

        expect(result.suggestion?.config).toEqual(
            expect.objectContaining({
                model: 'fake-main',
                jsonOutput: 'true',
                systemPrompt: expect.stringContaining('Count the requested elements'),
                promptTemplate: expect.stringContaining(
                    'User request: 입력한 텍스트에서 자음 개수를 찾아서 JSON으로 보여줘',
                ),
                outputSchema: expect.stringContaining('type: object'),
            }),
        );
    });

    it('does not force a plain-text prompt template when output format was not explicitly requested', async () => {
        const strategy = new AiGenerateNodeStrategy();

        const result = await strategy.apply(
            {
                id: 'ai-node',
                blockId: 'ai-generate',
                label: 'AI Node',
                config: {},
                inputPorts: [],
                outputPorts: [],
            },
            {
                flow: { blocks: [], nodes: [], edges: [] },
                input: {
                    userRequest: '자음과 모음의 개수를 분리해',
                    flow: { blocks: [], nodes: [], edges: [] },
                    desiredCount: 1,
                    wantsJson: false,
                },
                probeInsightsApplied: [],
            },
        );

        expect(result.suggestion?.config.promptTemplate).toContain('Return one result.');
        expect(result.suggestion?.config.promptTemplate).not.toContain('Return plain text.');
    });

    it('consumes architecture posture and validation hints explicitly', async () => {
        const strategy = new AiGenerateNodeStrategy();

        const result = await strategy.apply(
            {
                id: 'ai-node',
                blockId: 'ai-generate',
                label: 'AI Node',
                config: {},
                inputPorts: [],
                outputPorts: [],
            },
            {
                flow: { blocks: [], nodes: [], edges: [] },
                input: {
                    userRequest: '그래프(json)를 보고 이게 뭐하는 것인지 설명(md) 해줘',
                    flow: { blocks: [], nodes: [], edges: [] },
                    desiredCount: 1,
                    wantsJson: false,
                    designBrief: {
                        mission: {
                            summary: 'Explain the provided graph JSON.',
                            goal: '그래프 설명',
                            operationModel: ['explain'],
                        },
                        inputContract: {
                            format: 'json',
                            source: 'synthetic',
                            concreteInputPresent: false,
                            missingRequiredInput: true,
                            notes: [],
                        },
                        outputContract: {
                            format: 'markdown',
                            structured: false,
                            cardinality: 'single',
                        },
                        executionPosture: {
                            strategy: 'ai-first',
                            rationale: ['Explanation quality depends on structure interpretation.'],
                        },
                        successCriteria: ['Describe purpose and structure.'],
                        validationPlan: {
                            sampleCases: [],
                            assertions: ['Cover main nodes and edges.'],
                            confidenceCeiling: 'uncertain',
                        },
                        designPrinciples: ['Keep the explanation grounded in structure.'],
                        riskFlags: [],
                        strategicAssumptions: [],
                        knowledgeReferences: [],
                    },
                },
                probeInsightsApplied: [],
            },
        );

        expect(result.suggestion?.config.systemPrompt).toContain('Strategic posture: ai-first');
        expect(result.suggestion?.config.systemPrompt).toContain('Explain the provided graph JSON.');
        expect(result.suggestion?.config.promptTemplate).toContain('Validation targets: Cover main nodes and edges.');
    });

    it('selects a corrected-text schema for text editing requests when JSON output is requested', async () => {
        const strategy = new AiGenerateNodeStrategy();

        const result = await strategy.apply(
            {
                id: 'ai-node',
                blockId: 'ai-generate',
                label: 'AI Node',
                config: {},
                inputPorts: [],
                outputPorts: [],
            },
            {
                flow: { blocks: [], nodes: [], edges: [] },
                input: {
                    userRequest: '이메일 초안의 오타를 JSON으로 정정해줘',
                    flow: { blocks: [], nodes: [], edges: [] },
                    desiredCount: 1,
                    wantsJson: true,
                    designBrief: {
                        mission: {
                            summary: 'Edit or correct the provided text.',
                            goal: '오타 정정',
                            operationModel: ['edit', 'transform'],
                        },
                        inputContract: {
                            format: 'text',
                            source: 'user-provided',
                            concreteInputPresent: true,
                            missingRequiredInput: false,
                            notes: [],
                        },
                        outputContract: {
                            format: 'json',
                            structured: true,
                            cardinality: 'single',
                        },
                        executionPosture: {
                            strategy: 'ai-first',
                            rationale: ['Editing quality depends on text interpretation.'],
                        },
                        successCriteria: ['Return the corrected text.'],
                        validationPlan: {
                            sampleCases: [],
                            assertions: ['Preserve the intended meaning while correcting typos.'],
                            confidenceCeiling: 'fulfilled',
                        },
                        designPrinciples: ['Keep the revision faithful to the input.'],
                        riskFlags: [],
                        strategicAssumptions: [],
                        knowledgeReferences: [],
                    },
                },
                probeInsightsApplied: [],
            },
        );

        expect(result.suggestion?.config.outputSchema).toContain('correctedText');
    });

    it('selects a keyword-list schema for keyword analysis requests when JSON output is requested', async () => {
        const strategy = new AiGenerateNodeStrategy();

        const result = await strategy.apply(
            {
                id: 'ai-node',
                blockId: 'ai-generate',
                label: 'AI Node',
                config: {},
                inputPorts: [],
                outputPorts: [],
            },
            {
                flow: { blocks: [], nodes: [], edges: [] },
                input: {
                    userRequest: '블로그 내용을 보고 핵심 키워드를 JSON으로 추출해줘',
                    flow: { blocks: [], nodes: [], edges: [] },
                    desiredCount: 1,
                    wantsJson: true,
                    designBrief: {
                        mission: {
                            summary: 'Extract representative keywords from the provided text.',
                            goal: '키워드 추출',
                            operationModel: ['extract', 'classify', 'transform'],
                        },
                        inputContract: {
                            format: 'text',
                            source: 'user-provided',
                            concreteInputPresent: true,
                            missingRequiredInput: false,
                            notes: [],
                        },
                        outputContract: {
                            format: 'json',
                            structured: true,
                            cardinality: 'multiple',
                        },
                        executionPosture: {
                            strategy: 'ai-first',
                            rationale: ['Keyword salience depends on text interpretation.'],
                        },
                        successCriteria: ['Return a concise keyword list.'],
                        validationPlan: {
                            sampleCases: [],
                            assertions: ['Extract representative keywords without duplication.'],
                            confidenceCeiling: 'fulfilled',
                        },
                        designPrinciples: ['Prefer representative keywords over verbose phrases.'],
                        riskFlags: [],
                        strategicAssumptions: [],
                        knowledgeReferences: [],
                    },
                },
                probeInsightsApplied: [],
            },
        );

        expect(result.suggestion?.config.outputSchema).toContain('keywords');
    });

    it('selects an analysis-report schema for diagnostic analysis requests when JSON output is requested', async () => {
        const strategy = new AiGenerateNodeStrategy();

        const result = await strategy.apply(
            {
                id: 'ai-node',
                blockId: 'ai-generate',
                label: 'AI Node',
                config: {},
                inputPorts: [],
                outputPorts: [],
            },
            {
                flow: { blocks: [], nodes: [], edges: [] },
                input: {
                    userRequest: '에러 로그를 보고 문제점을 JSON으로 정리해줘',
                    flow: { blocks: [], nodes: [], edges: [] },
                    desiredCount: 1,
                    wantsJson: true,
                    designBrief: {
                        mission: {
                            summary: 'Diagnose the likely issue and causes for the provided log.',
                            goal: '에러 로그 진단',
                            operationModel: ['diagnose', 'extract', 'transform'],
                        },
                        inputContract: {
                            format: 'text',
                            source: 'user-provided',
                            concreteInputPresent: true,
                            missingRequiredInput: false,
                            notes: [],
                        },
                        outputContract: {
                            format: 'json',
                            structured: true,
                            cardinality: 'single',
                        },
                        semanticFacets: {
                            subject: 'log-data',
                            inputShape: 'log-text',
                            preferredTemplateTraits: ['analysis-workflow', 'diagnostic-analysis'],
                            disallowedTemplateTraits: ['graph-structured-input'],
                            requiredOutputTraits: ['sectioned-report-output', 'json-output'],
                        },
                        executionPosture: {
                            strategy: 'ai-first',
                            rationale: ['Diagnostic quality depends on interpreting the log context.'],
                        },
                        successCriteria: ['Return a concise issue summary and likely causes.'],
                        validationPlan: {
                            sampleCases: [],
                            assertions: ['Make the issue and next steps easy to review.'],
                            confidenceCeiling: 'fulfilled',
                        },
                        designPrinciples: ['Prefer concrete root-cause wording over vague explanation.'],
                        riskFlags: [],
                        strategicAssumptions: [],
                        knowledgeReferences: [],
                    },
                },
                probeInsightsApplied: [],
            },
        );

        expect(result.suggestion?.config.outputSchema).toContain('issueSummary');
        expect(result.suggestion?.config.outputSchema).toContain('likelyCauses');
    });

    it('does not force JSON mode when the architecture brief explicitly prefers markdown', async () => {
        const strategy = new AiGenerateNodeStrategy();

        const result = await strategy.apply(
            {
                id: 'ai-node',
                blockId: 'ai-generate',
                label: 'AI Node',
                config: {},
                inputPorts: [],
                outputPorts: [],
            },
            {
                flow: { blocks: [], nodes: [], edges: [] },
                input: {
                    userRequest: '그래프(json)를 보고 이게 뭐하는 것인지 설명(md) 해줘',
                    flow: { blocks: [], nodes: [], edges: [] },
                    desiredCount: 1,
                    wantsJson: true,
                    designBrief: {
                        mission: {
                            summary: 'Explain the provided graph JSON.',
                            goal: '그래프 설명',
                            operationModel: ['explain', 'transform'],
                        },
                        inputContract: {
                            format: 'json',
                            source: 'synthetic',
                            concreteInputPresent: false,
                            missingRequiredInput: true,
                            notes: [],
                        },
                        outputContract: {
                            format: 'markdown',
                            structured: false,
                            cardinality: 'single',
                        },
                        semanticFacets: {
                            subject: 'graph-structured-data',
                            inputShape: 'graph-json',
                            preferredTemplateTraits: ['graph-structured-input', 'explanation-workflow'],
                            disallowedTemplateTraits: ['json-output'],
                            requiredOutputTraits: ['markdown-output'],
                        },
                        executionPosture: {
                            strategy: 'ai-first',
                            rationale: ['Explanation quality depends on structure interpretation.'],
                        },
                        successCriteria: ['Describe purpose and structure.'],
                        validationPlan: {
                            sampleCases: [],
                            assertions: ['Cover main nodes and edges.'],
                            confidenceCeiling: 'uncertain',
                        },
                        designPrinciples: ['Keep the explanation grounded in structure.'],
                        riskFlags: [],
                        strategicAssumptions: [],
                        knowledgeReferences: [],
                    },
                },
                probeInsightsApplied: [],
            },
        );

        expect(result.suggestion?.config.jsonOutput).toBe('false');
        expect(result.suggestion?.config.outputSchema).toBe('');
        expect(result.suggestion?.config.promptTemplate).toContain('Return markdown only.');
    });
});
