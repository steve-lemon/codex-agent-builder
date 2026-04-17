// Vitest specs for manifest-backed flow-design knowledge sources.
import { describe, expect, it } from 'vitest';
import { analyzeFlowRequest, designFlowDraft, reflectFlowExecution } from './core';
import { availableFlowBlocks } from './catalog';
import { ManifestFlowDesignKnowledgeSource, createDefaultFlowDesignKnowledgeSource } from './knowledge-sources';
import { DeterministicFlowDesignProvider } from './provider';

describe('flow-design knowledge sources', () => {
    it('loads draft and reflection notes from a manifest file', async () => {
        const intent = await analyzeFlowRequest('상품 소개 문구를 JSON 형태로 여러개 만들어줘');
        const source = new ManifestFlowDesignKnowledgeSource(async () => ({
            taskTypes: [],
            taskGraphTemplates: [],
            classifierPrompts: {
                taskTypeSystemPrompt: 'classify task type',
                taskGraphSystemPrompt: 'classify task graph',
            },
            defaults: {
                sampleInputs: {
                    default: 'default',
                    keywordDriven: 'keyword',
                    byTaskType: {},
                },
                systemPrompts: {
                    unknown: 'unknown',
                },
                aiNodeDefaults: {
                    model: 'model',
                },
                probeDefaults: {
                    sampleConfig: {
                        model: 'probe-model',
                    },
                    sampleInputs: {
                        system: 'probe system',
                        prompt: 'probe prompt',
                    },
                },
                taskTypeSelection: {
                    jsonPreferredTaskTypeId: 'json-generation',
                    plainTextFallbackTaskTypeId: 'text-generation',
                },
            },
            knowledge: {
                sharedDraftNotes: ['base draft note'],
                conditionalDraftNotes: [
                    {
                        match: { wantsJson: true },
                        notes: ['json draft note'],
                    },
                ],
                reflectionNotes: ['base reflection note'],
                reflectionRules: [],
            },
        }));

        expect(await source.getDraftNotes(intent)).toEqual(
            expect.arrayContaining(['base draft note', 'json draft note']),
        );
        expect(
            await source.getReflectionNotes({
                intent,
                sampleResult: {
                    status: 'completed',
                    logs: [],
                },
                reflection: {
                    satisfied: true,
                    summary: 'ok',
                    issues: [],
                    suggestedImprovements: [],
                },
            }),
        ).toEqual(expect.arrayContaining(['base reflection note']));
    });

    it('default provider feeds manifest guidance into draft composition and reflection', async () => {
        const provider = new DeterministicFlowDesignProvider(createDefaultFlowDesignKnowledgeSource());
        const intent = await provider.analyzeRequest('키워드를 줄테니 블로그 타이틀 여러개 만들기');
        const draft = await provider.composeDraft({
            userRequest: intent.userRequest,
            sampleInput: intent.sampleInput,
            desiredCount: intent.desiredCount,
            wantsJson: intent.wantsJson,
            availableBlocks: availableFlowBlocks,
        });
        const reflection = await provider.reflectExecution({
            userRequest: intent.userRequest,
            desiredCount: intent.desiredCount,
            wantsJson: intent.wantsJson,
            sampleResult: {
                status: 'completed',
                output: '짧음',
                logs: [],
            },
        });

        const systemNode = draft.flow.nodes.find(node => node.id === 'system-input');
        expect(systemNode?.config?.input).toContain('Ground the design in graph-based preflight validation');
        expect(reflection.suggestedImprovements).toEqual(
            expect.arrayContaining(['Prefer deterministic sample execution before accepting the design.']),
        );
    });

    it('core still accepts explicit guidance notes for direct callers', async () => {
        const draft = await designFlowDraft({
            userRequest: '키워드를 줄테니 블로그 타이틀 여러개 만들기',
            sampleInput: '생산성 향상',
            desiredCount: 5,
            wantsJson: false,
            availableBlocks: availableFlowBlocks,
            guidanceNotes: ['custom guidance note'],
        });
        const reflection = await reflectFlowExecution({
            userRequest: '키워드를 줄테니 블로그 타이틀 여러개 만들기',
            desiredCount: 5,
            wantsJson: false,
            sampleResult: {
                status: 'completed',
                output: '짧음',
                logs: [],
            },
            reflectionNotes: ['custom reflection note'],
        });

        expect(draft.flow.nodes.find(node => node.id === 'system-input')?.config?.input).toContain(
            'custom guidance note',
        );
        expect(reflection.suggestedImprovements).toContain('custom reflection note');
    });
});
