// Vitest specs for the shared node-config design core.
import { describe, expect, it } from 'vitest';
import { BuiltinFlowBlockIds, getBuiltinFlowBlock } from '../../block-pool';
import { createFlowDocument, createFlowNode, connectFlowPorts } from '../../document';
import { NodeConfigDesignService } from './core';
import { createDefaultNodeConfigKnowledgeSource } from './knowledge-sources';

describe('node-config design core', () => {
    it('applies block-specific strategies and tracks assignments without tool wrappers', async () => {
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
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'system-input',
            sourcePort: 'output',
            targetNodeId: 'ai-node',
            targetPort: 'system',
        }).flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'prompt-input',
            sourcePort: 'output',
            targetNodeId: 'ai-node',
            targetPort: 'prompt',
        }).flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'ai-node',
            sourcePort: 'output',
            targetNodeId: 'view-output',
            targetPort: 'input',
        }).flow;

        const service = new NodeConfigDesignService();
        const result = await service.design({
            userRequest: '블로그 타이틀 여러개 만들어줘',
            flow,
            desiredCount: 5,
            wantsJson: false,
            strategyDirectives: [
                {
                    strategyId: 'prompt-input',
                    note: 'Ask for exactly 5 outputs with explicit wording.',
                },
            ],
        });

        expect(result.appliedStrategyIds).toEqual(
            expect.arrayContaining(['system-input', 'prompt-input', 'ai-generation', 'view-observer']),
        );
        expect(result.nodeStrategyAssignments).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ nodeId: 'prompt-input', strategyId: 'prompt-input' }),
                expect.objectContaining({ nodeId: 'ai-node', strategyId: 'ai-generation' }),
            ]),
        );
    });

    it('merges knowledge-source notes into strategy inputs', async () => {
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

        const service = new NodeConfigDesignService(undefined, {
            getSharedNotes() {
                return ['Prefer stronger wording for high-signal prompts.'];
            },
            getStrategyDirectives() {
                return [
                    {
                        strategyId: 'ai-generation',
                        note: 'Use a structured-output capable profile.',
                    },
                ];
            },
        });

        const result = await service.design({
            userRequest: '상품 소개 문구를 JSON 형태로 여러개 만들어줘',
            flow,
            desiredCount: 3,
            wantsJson: true,
        });

        const aiSuggestion = result.suggestions.find(suggestion => suggestion.nodeId === 'ai-node');
        expect(aiSuggestion?.config.model).toBe('fake-main');
    });

    it('uses default knowledge sources to consume block metadata and skill guidance', async () => {
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

        const service = new NodeConfigDesignService(undefined, createDefaultNodeConfigKnowledgeSource());
        const result = await service.design({
            userRequest: '상품 소개 문구를 JSON 형태로 여러개 만들어줘',
            flow,
            desiredCount: 3,
            wantsJson: true,
        });

        const systemSuggestion = result.suggestions.find(suggestion => suggestion.nodeId === 'system-input');
        const aiSuggestion = result.suggestions.find(suggestion => suggestion.nodeId === 'ai-node');

        expect(systemSuggestion?.rationale.join(' ')).toContain('Apply strategy guidance');
        expect(aiSuggestion?.rationale.join(' ')).toContain('Apply AI configuration strategy notes');
    });
});
