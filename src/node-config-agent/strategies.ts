// Block-specific configuration strategies for the node-configuration sub-agent.
import type { FlowDocument, FlowNode } from '../flow/types';
import type {
    NodeConfigurationDesignInput,
    NodeConfigurationSuggestion,
    NodeConfigurationValidationResult,
} from './types';

function inferTaskType(
    userRequest: string,
    wantsJson: boolean,
): 'blog-title-generation' | 'json-generation' | 'text-generation' {
    const lowered = userRequest.toLowerCase();
    if (
        lowered.includes('blog') ||
        lowered.includes('title') ||
        userRequest.includes('타이틀') ||
        userRequest.includes('제목')
    ) {
        return 'blog-title-generation';
    }
    if (wantsJson) {
        return 'json-generation';
    }
    return 'text-generation';
}

function collectProbeInsights(input: NodeConfigurationDesignInput): string[] {
    if (!input.probeResult) {
        return [];
    }

    return [...(input.probeResult.behaviorNotes ?? []), ...(input.probeResult.mismatchesFromSpec ?? [])];
}

function collectStrategyNotes(input: NodeConfigurationDesignInput): string[] {
    return input.strategyNotes ?? [];
}

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

function applyNodeConfig(node: FlowNode, config: Record<string, string>): FlowNode {
    return {
        ...node,
        config,
    };
}

export interface NodeBlockConfigStrategyContext {
    flow: FlowDocument;
    input: NodeConfigurationDesignInput;
    probeInsightsApplied: string[];
}

export interface NodeBlockConfigStrategyResult {
    node: FlowNode;
    suggestion?: NodeConfigurationSuggestion;
}

/** Contract for per-block configuration strategies used by the node-config sub-agent. */
export interface NodeBlockConfigStrategy {
    blockId: string;
    supports?(node: FlowNode): boolean;
    apply(node: FlowNode, context: NodeBlockConfigStrategyContext): NodeBlockConfigStrategyResult;
    validate?(node: FlowNode, flow: FlowDocument): string[];
}

/** Strategy for the system input node that constrains downstream AI behavior. */
export class SystemInputNodeStrategy implements NodeBlockConfigStrategy {
    blockId = 'input';

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

/** Strategy for the AI block that selects model/output mode from task and reflection signals. */
export class AiGenerateNodeStrategy implements NodeBlockConfigStrategy {
    blockId = 'ai-generate';

    apply(node: FlowNode, context: NodeBlockConfigStrategyContext): NodeBlockConfigStrategyResult {
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

    validate(node: FlowNode): string[] {
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

/** Strategy for the buffer block that keeps timing deterministic and explicit. */
export class BufferNodeStrategy implements NodeBlockConfigStrategy {
    blockId = 'buffer';

    apply(node: FlowNode, context: NodeBlockConfigStrategyContext): NodeBlockConfigStrategyResult {
        const preferredWait = collectStrategyNotes(context.input).find(note => note.toLowerCase().includes('delay'))
            ? '50'
            : node.config?.wait ?? '0';
        const config = {
            ...(node.config ?? {}),
            wait: preferredWait,
        };

        return {
            node: applyNodeConfig(node, config),
            suggestion: {
                nodeId: node.id,
                blockId: node.blockId,
                config,
                rationale: [
                    'Ensure buffer nodes have an explicit wait configuration for deterministic execution.',
                    ...(collectStrategyNotes(context.input).length > 0
                        ? [`Respect timing-oriented strategy notes: ${collectStrategyNotes(context.input).join(' | ')}`]
                        : []),
                ],
            },
        };
    }
}

/** Strategy for view blocks that are primarily used for output inspection/logging. */
export class ViewNodeStrategy implements NodeBlockConfigStrategy {
    blockId = 'view';

    apply(node: FlowNode): NodeBlockConfigStrategyResult {
        return {
            node,
            suggestion: {
                nodeId: node.id,
                blockId: node.blockId,
                config: node.config ?? {},
                rationale: ['Keep the view node focused on output inspection so the final sample remains observable.'],
            },
        };
    }
}

/** Returns the default block-specific strategy set used by the node-config sub-agent. */
export function createDefaultNodeBlockConfigStrategies(): NodeBlockConfigStrategy[] {
    return [
        new SystemInputNodeStrategy(),
        new PromptInputNodeStrategy(),
        new AiGenerateNodeStrategy(),
        new BufferNodeStrategy(),
        new ViewNodeStrategy(),
    ];
}
