// Input-node configuration strategies for system and user prompt blocks.
import type { FlowNode } from '../../flow/types';
import type { NodeConfigurationDesignInput } from '../types';
import {
    applyNodeConfig,
    collectStrategyNotes,
    inferTaskType,
    type NodeBlockConfigStrategy,
    type NodeBlockConfigStrategyContext,
    type NodeBlockConfigStrategyResult,
} from './shared';

function buildSystemPrompt(input: NodeConfigurationDesignInput): string {
    const taskType = inferTaskType(input.userRequest, input.wantsJson);
    const basePrompt =
        taskType === 'blog-title-generation'
            ? 'You generate clear and catchy blog titles based on one keyword.'
            : input.wantsJson
            ? 'You return concise structured output that can be safely parsed as JSON.'
            : 'You transform text requests into concise useful outputs.';
    const probeHint = input.probeResult?.behaviorNotes?.[0]?.trim()
        ? ` Observed block behavior: ${input.probeResult.behaviorNotes[0].trim()}`
        : '';
    const strategyHint =
        collectStrategyNotes(input).length > 0 ? ` Strategy focus: ${collectStrategyNotes(input).join(' | ')}` : '';
    const improvementHint =
        input.improvementNotes && input.improvementNotes.length > 0
            ? ` Improvements to apply: ${input.improvementNotes.join(' | ')}`
            : '';

    return `${basePrompt}${probeHint}${strategyHint}${improvementHint}`;
}

function buildUserPrompt(input: NodeConfigurationDesignInput): string {
    const desiredCountInstruction =
        input.desiredCount > 1 ? `Return exactly ${input.desiredCount} results.` : 'Return one result.';
    const formatInstruction = input.wantsJson
        ? 'Return JSON only.'
        : input.desiredCount > 1
        ? 'Return each result on its own line.'
        : 'Return plain text.';
    const probeHint = input.probeResult?.mismatchesFromSpec?.[0]?.trim()
        ? ` Keep in mind this observed behavior detail: ${input.probeResult.mismatchesFromSpec[0].trim()}`
        : '';
    const strategyHint =
        collectStrategyNotes(input).length > 0 ? ` Strategy notes: ${collectStrategyNotes(input).join(' | ')}` : '';
    const improvementText =
        input.improvementNotes && input.improvementNotes.length > 0
            ? ` Improvement notes: ${input.improvementNotes.join(' | ')}`
            : '';

    return `User request: ${input.userRequest}. ${desiredCountInstruction} ${formatInstruction}${probeHint}${strategyHint}${improvementText}`;
}

/** Strategy for the system input node that constrains downstream AI behavior. */
export class SystemInputNodeStrategy implements NodeBlockConfigStrategy {
    blockId = 'input';
    strategyId = 'system-input';

    supports(node: FlowNode): boolean {
        return node.id === 'system-input';
    }

    apply(node: FlowNode, context: NodeBlockConfigStrategyContext): NodeBlockConfigStrategyResult {
        const config = {
            ...(node.config ?? {}),
            input: buildSystemPrompt(context.input),
        };

        return {
            node: applyNodeConfig(node, config),
            suggestion: {
                nodeId: node.id,
                blockId: node.blockId,
                config,
                rationale: [
                    'Populate the system prompt so downstream AI behavior is constrained consistently.',
                    ...(context.probeInsightsApplied.length > 0
                        ? [`Incorporate observed block behavior: ${context.probeInsightsApplied[0]}`]
                        : []),
                    ...(collectStrategyNotes(context.input).length > 0
                        ? [`Apply strategy guidance: ${collectStrategyNotes(context.input).join(' | ')}`]
                        : []),
                ],
            },
        };
    }

    validate(node: FlowNode): string[] {
        return !node.config?.input?.trim() ? [`Input node is missing prompt text: ${node.id}`] : [];
    }
}

/** Strategy for the user prompt node that shapes count, format, and wording. */
export class PromptInputNodeStrategy implements NodeBlockConfigStrategy {
    blockId = 'input';
    strategyId = 'prompt-input';

    supports(node: FlowNode): boolean {
        return node.id === 'prompt-input';
    }

    apply(node: FlowNode, context: NodeBlockConfigStrategyContext): NodeBlockConfigStrategyResult {
        const config = {
            ...(node.config ?? {}),
            input: buildUserPrompt(context.input),
        };

        return {
            node: applyNodeConfig(node, config),
            suggestion: {
                nodeId: node.id,
                blockId: node.blockId,
                config,
                rationale: [
                    'Populate the user-facing prompt with output count, format, and improvement hints.',
                    ...(context.probeInsightsApplied.length > 1
                        ? [`Reflect observed output caveats: ${context.probeInsightsApplied[1]}`]
                        : []),
                    ...(collectStrategyNotes(context.input).length > 0
                        ? [
                              `Embed strategy notes into the request wording: ${collectStrategyNotes(
                                  context.input,
                              ).join(' | ')}`,
                          ]
                        : []),
                ],
            },
        };
    }

    validate(node: FlowNode): string[] {
        return !node.config?.input?.trim() ? [`Input node is missing prompt text: ${node.id}`] : [];
    }
}
