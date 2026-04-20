// AI block strategy for model and structured-output configuration.
import { buildFlowOutputFormatInstruction } from '../../../output-contract';
import {
    getNodeConfigModelProfile,
    getNodeConfigOutputSchemaDefault,
    getNodeConfigSystemPromptDefault,
} from '../../design/resources';
import {
    collectStrategyNotesFor,
    ensureDesignBrief,
    inferTaskTypeWithInput,
    applyNodeConfig,
    type NodeBlockConfigStrategy,
    type NodeBlockConfigStrategyContext,
    type NodeBlockConfigStrategyResult,
} from './shared';
import type { NodeConfigurationDesignInput } from '../types';

async function selectModel(input: NodeConfigurationDesignInput): Promise<string> {
    const taskType = await inferTaskTypeWithInput(input);
    const brief = await ensureDesignBrief(input);
    const strategyNotes = collectStrategyNotesFor(input, 'ai-generation').join(' ').toLowerCase();
    const effectiveWantsJson =
        brief.outputContract.format === 'json' || (brief.outputContract.format === 'unspecified' && input.wantsJson);
    return await getNodeConfigModelProfile({
        taskType,
        wantsJson: effectiveWantsJson,
        strategyNotes: `${strategyNotes} ${brief.executionPosture.strategy}`.trim(),
    });
}

async function buildAiDefaults(input: NodeConfigurationDesignInput): Promise<{
    systemPrompt: string;
    promptTemplate: string;
    outputSchema: string;
}> {
    const taskType = await inferTaskTypeWithInput(input);
    const brief = await ensureDesignBrief(input);
    const effectiveWantsJson =
        brief.outputContract.format === 'json' || (brief.outputContract.format === 'unspecified' && input.wantsJson);
    const outputContract = {
        format: brief.outputContract.format,
        explicitFormat: brief.outputContract.format !== 'unspecified',
        desiredCount: input.desiredCount,
        wantsMultiple: input.desiredCount > 1,
        wantsJson: effectiveWantsJson,
    } as const;
    const systemPrompt = await getNodeConfigSystemPromptDefault(taskType);
    const countInstruction =
        input.desiredCount > 1 ? `Return exactly ${input.desiredCount} results.` : 'Return one result.';
    const outputInstruction = buildFlowOutputFormatInstruction(outputContract);
    return {
        systemPrompt: `${systemPrompt} Strategic posture: ${brief.executionPosture.strategy}. Mission: ${brief.mission.summary}`,
        promptTemplate: `User request: ${input.userRequest}. ${[countInstruction, outputInstruction]
            .filter(Boolean)
            .join(' ')} Validation targets: ${brief.validationPlan.assertions.slice(0, 2).join(' | ')}`,
        outputSchema: await getNodeConfigOutputSchemaDefault({
            taskType,
            wantsJson: effectiveWantsJson,
            userRequest: input.userRequest,
            desiredCount: input.desiredCount,
            brief,
        }),
    };
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
        const aiDefaults = await buildAiDefaults(context.input);
        const brief = await ensureDesignBrief(context.input);
        const effectiveWantsJson =
            brief.outputContract.format === 'json' ||
            (brief.outputContract.format === 'unspecified' && context.input.wantsJson);
        const config = {
            ...(node.config ?? {}),
            model: await selectModel(context.input),
            systemPrompt: aiDefaults.systemPrompt,
            promptTemplate: aiDefaults.promptTemplate,
            outputSchema: aiDefaults.outputSchema,
            jsonOutput: String(effectiveWantsJson),
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
                    'Populate fallback system/prompt settings so the AI node remains understandable in the editor and can execute with config defaults.',
                    ...(effectiveWantsJson
                        ? [
                              'Populate an output schema when JSON output is expected so structured validation can happen later.',
                          ]
                        : []),
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
        if (!node.config?.systemPrompt?.trim()) {
            issues.push(`AI node is missing a systemPrompt configuration: ${node.id}`);
        }
        if (!node.config?.promptTemplate?.trim()) {
            issues.push(`AI node is missing a promptTemplate configuration: ${node.id}`);
        }
        return issues;
    }
}
