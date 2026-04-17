// Vitest specs for manifest-backed node-config knowledge sources.
import { describe, expect, it } from 'vitest';
import { BuiltinFlowBlockIds, getBuiltinFlowBlock } from '../flow/block-pool';
import { createFlowDocument, createFlowNode } from '../flow/document';
import {
    ManifestSkillDocumentNodeConfigKnowledgeSource,
    createDefaultNodeConfigKnowledgeSource,
} from './knowledge-sources';

describe('node-config knowledge sources', () => {
    it('loads shared notes and directives from a manifest file', async () => {
        const [InputBlock, AiGenerateBlock, ViewBlock] = await Promise.all([
            getBuiltinFlowBlock(BuiltinFlowBlockIds.input),
            getBuiltinFlowBlock(BuiltinFlowBlockIds.aiGenerate),
            getBuiltinFlowBlock(BuiltinFlowBlockIds.view),
        ]);
        let flow = createFlowDocument([InputBlock, AiGenerateBlock, ViewBlock]);
        flow = createFlowNode(flow, InputBlock.id, { nodeId: 'system-input', label: 'System Input' }).flow;
        flow = createFlowNode(flow, AiGenerateBlock.id, { nodeId: 'ai-node', label: 'AI Node' }).flow;

        const source = new ManifestSkillDocumentNodeConfigKnowledgeSource(async () => ({
            defaults: {
                systemPrompts: {
                    unknown: 'fallback prompt',
                },
                aiModelProfiles: {
                    default: 'default-model',
                    'blog-title-generation': 'blog-model',
                    'structured-output': 'structured-model',
                },
                modelSelection: {
                    defaultProfileId: 'default',
                    jsonPreferredProfileId: 'structured-output',
                    taskTypeProfileIds: {
                        'blog-title-generation': 'blog-title-generation',
                    },
                    strategyNoteProfileRules: [],
                },
            },
            knowledge: {
                sharedNotes: ['base note'],
                conditionalSharedNotes: [
                    {
                        blockIds: ['ai-generate'],
                        notes: ['ai conditional note'],
                    },
                ],
                strategyDirectives: [
                    {
                        blockIds: ['ai-generate'],
                        strategyId: 'ai-generation',
                        note: 'manifest directive',
                    },
                ],
            },
        }));
        const notes = await source.getSharedNotes({
            userRequest: '상품 소개 문구를 JSON 형태로 여러개 만들어줘',
            flow,
            desiredCount: 3,
            wantsJson: true,
        });
        const directives = await source.getStrategyDirectives({
            userRequest: '상품 소개 문구를 JSON 형태로 여러개 만들어줘',
            flow,
            desiredCount: 3,
            wantsJson: true,
        });

        expect(notes).toEqual(expect.arrayContaining(['base note', 'ai conditional note']));
        expect(directives).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ strategyId: 'ai-generation', note: 'manifest directive' }),
            ]),
        );
    });

    it('default knowledge source combines file guidance with block metadata', async () => {
        const [InputBlock, AiGenerateBlock, ViewBlock] = await Promise.all([
            getBuiltinFlowBlock(BuiltinFlowBlockIds.input),
            getBuiltinFlowBlock(BuiltinFlowBlockIds.aiGenerate),
            getBuiltinFlowBlock(BuiltinFlowBlockIds.view),
        ]);
        let flow = createFlowDocument([InputBlock, AiGenerateBlock, ViewBlock]);
        flow = createFlowNode(flow, InputBlock.id, { nodeId: 'system-input', label: 'System Input' }).flow;
        flow = createFlowNode(flow, InputBlock.id, { nodeId: 'prompt-input', label: 'Prompt Input' }).flow;
        flow = createFlowNode(flow, AiGenerateBlock.id, { nodeId: 'ai-node', label: 'AI Node' }).flow;
        flow = createFlowNode(flow, ViewBlock.id, { nodeId: 'view-output', label: 'View Output' }).flow;

        const source = createDefaultNodeConfigKnowledgeSource();
        const notes = await source.getSharedNotes({
            userRequest: '블로그 타이틀 여러개 만들어줘',
            flow,
            desiredCount: 5,
            wantsJson: false,
        });
        const directives = await source.getStrategyDirectives({
            userRequest: '블로그 타이틀 여러개 만들어줘',
            flow,
            desiredCount: 5,
            wantsJson: false,
        });

        expect(notes).toEqual(
            expect.arrayContaining([
                'Use separate configuration strategies per block family instead of one generic prompt/config pass.',
                'Input blocks should carry explicit user-facing wording instead of placeholder text.',
                'AI blocks should align model profile, prompt wording, and output mode with the request intent.',
            ]),
        );
        expect(directives).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ strategyId: 'system-input' }),
                expect.objectContaining({ strategyId: 'prompt-input' }),
                expect.objectContaining({ strategyId: 'ai-generation' }),
            ]),
        );
    });
});
