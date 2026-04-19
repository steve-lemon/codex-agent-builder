// Input-node configuration strategies for system and user prompt blocks.
import type { FlowNode } from '../../../types';
import { buildFlowOutputFormatInstruction, inferFlowOutputContract } from '../../../output-contract';
import { getNodeConfigSystemPromptDefault } from '../../design/resources';
import type { NodeConfigurationDesignInput } from '../types';
import {
    applyNodeConfig,
    collectStrategyNotesFor,
    ensureDesignBrief,
    inferTaskTypeWithInput,
    type NodeBlockConfigStrategy,
    type NodeBlockConfigStrategyContext,
    type NodeBlockConfigStrategyResult,
} from './shared';

async function buildSystemPrompt(input: NodeConfigurationDesignInput): Promise<string> {
    const taskType = await inferTaskTypeWithInput(input);
    const brief = await ensureDesignBrief(input);
    const basePrompt = await getNodeConfigSystemPromptDefault(taskType);
    const probeHint = input.probeResult?.behaviorNotes?.[0]?.trim()
        ? ` Observed block behavior: ${input.probeResult.behaviorNotes[0].trim()}`
        : '';
    const strategyNotes = collectStrategyNotesFor(input, 'system-input');
    const strategyHint = strategyNotes.length > 0 ? ` Strategy focus: ${strategyNotes.join(' | ')}` : '';
    const architectureHint =
        brief.designPrinciples.length > 0 || brief.mission.summary
            ? ` Strategic framing: ${[brief.mission.summary, ...brief.designPrinciples.slice(0, 2)]
                  .filter(Boolean)
                  .join(' | ')}`
            : '';
    const improvementHint =
        input.improvementNotes && input.improvementNotes.length > 0
            ? ` Improvements to apply: ${input.improvementNotes.join(' | ')}`
            : '';

    return `${basePrompt}${probeHint}${strategyHint}${architectureHint}${improvementHint}`;
}

async function buildUserPrompt(input: NodeConfigurationDesignInput): Promise<string> {
    const brief = await ensureDesignBrief(input);
    const outputContract = inferFlowOutputContract(input.userRequest);
    const desiredCountInstruction =
        input.desiredCount > 1 ? `Return exactly ${input.desiredCount} results.` : 'Return one result.';
    const formatInstruction = buildFlowOutputFormatInstruction(outputContract);
    const probeHint = input.probeResult?.mismatchesFromSpec?.[0]?.trim()
        ? ` Keep in mind this observed behavior detail: ${input.probeResult.mismatchesFromSpec[0].trim()}`
        : '';
    const strategyNotes = collectStrategyNotesFor(input, 'prompt-input');
    const strategyHint = strategyNotes.length > 0 ? ` Strategy notes: ${strategyNotes.join(' | ')}` : '';
    const architectureHint =
        brief.validationPlan.assertions.length > 0
            ? ` Validation targets: ${brief.validationPlan.assertions.slice(0, 2).join(' | ')}`
            : '';
    const improvementText =
        input.improvementNotes && input.improvementNotes.length > 0
            ? ` Improvement notes: ${input.improvementNotes.join(' | ')}`
            : '';

    const instructions = [desiredCountInstruction, formatInstruction].filter(Boolean).join(' ');
    return `User request: ${input.userRequest}. ${instructions}${probeHint}${strategyHint}${architectureHint}${improvementText}`;
}

/** Strategy for the system input node that constrains downstream AI behavior. */
export class SystemInputNodeStrategy implements NodeBlockConfigStrategy {
    blockId = 'input';
    strategyId = 'system-input';

    supports(node: FlowNode): boolean {
        return node.id === 'system-input';
    }

    async apply(node: FlowNode, context: NodeBlockConfigStrategyContext): Promise<NodeBlockConfigStrategyResult> {
        const config = {
            ...(node.config ?? {}),
            input: await buildSystemPrompt(context.input),
        };

        return {
            node: applyNodeConfig(node, config),
            suggestion: {
                nodeId: node.id,
                blockId: node.blockId,
                strategyId: this.strategyId,
                config,
                rationale: [
                    'Populate the system prompt so downstream AI behavior is constrained consistently.',
                    ...(context.probeInsightsApplied.length > 0
                        ? [`Incorporate observed block behavior: ${context.probeInsightsApplied[0]}`]
                        : []),
                    ...(collectStrategyNotesFor(context.input, this.strategyId).length > 0
                        ? [
                              `Apply strategy guidance: ${collectStrategyNotesFor(context.input, this.strategyId).join(
                                  ' | ',
                              )}`,
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

/** Strategy for the user prompt node that shapes count, format, and wording. */
export class PromptInputNodeStrategy implements NodeBlockConfigStrategy {
    blockId = 'input';
    strategyId = 'prompt-input';

    supports(node: FlowNode): boolean {
        return node.id === 'prompt-input';
    }

    async apply(node: FlowNode, context: NodeBlockConfigStrategyContext): Promise<NodeBlockConfigStrategyResult> {
        const config = {
            ...(node.config ?? {}),
            input: await buildUserPrompt(context.input),
        };

        return {
            node: applyNodeConfig(node, config),
            suggestion: {
                nodeId: node.id,
                blockId: node.blockId,
                strategyId: this.strategyId,
                config,
                rationale: [
                    'Populate the user-facing prompt with output count, format, and improvement hints.',
                    ...(context.probeInsightsApplied.length > 1
                        ? [`Reflect observed output caveats: ${context.probeInsightsApplied[1]}`]
                        : []),
                    ...(collectStrategyNotesFor(context.input, this.strategyId).length > 0
                        ? [
                              `Embed strategy notes into the request wording: ${collectStrategyNotesFor(
                                  context.input,
                                  this.strategyId,
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
