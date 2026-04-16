// Vitest specs for the shared node-config design core.
import { describe, expect, it } from 'vitest';
import { AiGenerateBlock, InputBlock, ViewBlock } from '../flow/blocks';
import { createFlowDocument, createFlowNode, connectFlowPorts } from '../flow/document';
import { NodeConfigDesignService } from './core';

describe('node-config design core', () => {
    it('applies block-specific strategies and tracks assignments without tool wrappers', async () => {
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
        expect(aiSuggestion?.config.model).toBe('mock-structured-gpt');
    });
});
