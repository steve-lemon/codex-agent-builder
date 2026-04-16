// AI block strategy for model and structured-output configuration.
import {
    collectStrategyNotes,
    inferTaskType,
    applyNodeConfig,
    type NodeBlockConfigStrategy,
    type NodeBlockConfigStrategyContext,
    type NodeBlockConfigStrategyResult,
} from './shared';
import type { NodeConfigurationDesignInput } from '../types';

function selectModel(input: NodeConfigurationDesignInput): string {
    const taskType = inferTaskType(input.userRequest, input.wantsJson);
    const strategyNotes = collectStrategyNotes(input).join(' ').toLowerCase();

    if (strategyNotes.includes('json')) {
        return 'mock-structured-gpt';
    }
    if (strategyNotes.includes('title') || strategyNotes.includes('headline')) {
        return 'mock-blog-gpt';
    }
    if (input.wantsJson) {
        return 'mock-structured-gpt';
    }
    if (taskType === 'blog-title-generation') {
        return 'mock-blog-gpt';
    }
    return 'mock-flow-model';
}

/** Strategy for the AI block that selects model/output mode from task and reflection signals. */
export class AiGenerateNodeStrategy implements NodeBlockConfigStrategy {
    blockId = 'ai-generate';
    strategyId = 'ai-generation';

    apply(
        node: Parameters<NodeBlockConfigStrategy['apply']>[0],
        context: NodeBlockConfigStrategyContext,
    ): NodeBlockConfigStrategyResult {
        const config = {
            ...(node.config ?? {}),
            model: selectModel(context.input),
            jsonOutput: String(context.input.wantsJson),
        };

        return {
            node: applyNodeConfig(node, config),
            suggestion: {
                nodeId: node.id,
                blockId: node.blockId,
                config,
                rationale: [
                    'Choose an AI model profile that matches the requested output style.',
                    'Keep jsonOutput aligned with the request so downstream parsing expectations stay stable.',
                    ...(context.probeInsightsApplied.length > 0
                        ? ['Use the probe result to keep model and prompt assumptions aligned with observed behavior.']
                        : []),
                    ...(collectStrategyNotes(context.input).length > 0
                        ? [`Apply AI configuration strategy notes: ${collectStrategyNotes(context.input).join(' | ')}`]
                        : []),
                ],
            },
        };
    }

    validate(node: Parameters<NonNullable<NodeBlockConfigStrategy['validate']>>[0]): string[] {
        const issues: string[] = [];
        if (!node.config?.model?.trim()) {
            issues.push(`AI node is missing a model configuration: ${node.id}`);
        }
        if (!node.config?.jsonOutput?.trim()) {
            issues.push(`AI node is missing a jsonOutput configuration: ${node.id}`);
        }
        return issues;
    }
}
