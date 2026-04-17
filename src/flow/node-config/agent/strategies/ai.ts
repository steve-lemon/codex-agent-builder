// AI block strategy for model and structured-output configuration.
import { getNodeConfigModelProfile } from '../../design/resources';
import {
    collectStrategyNotesFor,
    inferTaskType,
    applyNodeConfig,
    type NodeBlockConfigStrategy,
    type NodeBlockConfigStrategyContext,
    type NodeBlockConfigStrategyResult,
} from './shared';
import type { NodeConfigurationDesignInput } from '../types';

async function selectModel(input: NodeConfigurationDesignInput): Promise<string> {
    const taskType = await inferTaskType(input.userRequest, input.wantsJson);
    const strategyNotes = collectStrategyNotesFor(input, 'ai-generation').join(' ').toLowerCase();
    return await getNodeConfigModelProfile({
        taskType,
        wantsJson: input.wantsJson,
        strategyNotes,
    });
}

/** Strategy for the AI block that selects model/output mode from task and reflection signals. */
export class AiGenerateNodeStrategy implements NodeBlockConfigStrategy {
    blockId = 'ai-generate';
    strategyId = 'ai-generation';

    apply(
        node: Parameters<NodeBlockConfigStrategy['apply']>[0],
        context: NodeBlockConfigStrategyContext,
    ): Promise<NodeBlockConfigStrategyResult> {
        return this.applyAsync(node, context);
    }

    private async applyAsync(
        node: Parameters<NodeBlockConfigStrategy['apply']>[0],
        context: NodeBlockConfigStrategyContext,
    ): Promise<NodeBlockConfigStrategyResult> {
        const config = {
            ...(node.config ?? {}),
            model: await selectModel(context.input),
            jsonOutput: String(context.input.wantsJson),
        };

        return {
            node: applyNodeConfig(node, config),
            suggestion: {
                nodeId: node.id,
                blockId: node.blockId,
                strategyId: this.strategyId,
                config,
                rationale: [
                    'Choose an AI model profile that matches the requested output style.',
                    'Keep jsonOutput aligned with the request so downstream parsing expectations stay stable.',
                    ...(context.probeInsightsApplied.length > 0
                        ? ['Use the probe result to keep model and prompt assumptions aligned with observed behavior.']
                        : []),
                    ...(collectStrategyNotesFor(context.input, this.strategyId).length > 0
                        ? [
                              `Apply AI configuration strategy notes: ${collectStrategyNotesFor(
                                  context.input,
                                  this.strategyId,
                              ).join(' | ')}`,
                          ]
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
