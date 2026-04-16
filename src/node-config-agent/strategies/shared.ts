// Shared contracts and helpers for block-specific node-configuration strategies.
import type { FlowDocument, FlowNode } from '../../flow/types';
import type { NodeConfigurationDesignInput, NodeConfigurationSuggestion } from '../types';

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
    strategyId: string;
    supports?(node: FlowNode): boolean;
    apply(node: FlowNode, context: NodeBlockConfigStrategyContext): NodeBlockConfigStrategyResult;
    validate?(node: FlowNode, flow: FlowDocument): string[];
}

export function inferTaskType(
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

export function collectStrategyNotes(input: NodeConfigurationDesignInput): string[] {
    return input.strategyNotes ?? [];
}

export function collectStrategyNotesFor(input: NodeConfigurationDesignInput, strategyId: string): string[] {
    return [
        ...(input.strategyNotes ?? []),
        ...(input.strategyDirectives ?? [])
            .filter(directive => directive.strategyId === strategyId)
            .map(directive => directive.note),
    ];
}

export function applyNodeConfig(node: FlowNode, config: Record<string, string>): FlowNode {
    return {
        ...node,
        config,
    };
}
