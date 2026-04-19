// Shared contracts and helpers for block-specific node-configuration strategies.
import type { FlowDocument, FlowNode } from '../../../types';
import { analyzeFlowRequest } from '../../../design/core';
import { createFlowDesignTaskTypeAdvisor, getFlowDesignTaskTypeCatalog } from '../../../design/task-types';
import type { DesignBrief } from '../../../design/types';
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
    apply(
        node: FlowNode,
        context: NodeBlockConfigStrategyContext,
    ): Promise<NodeBlockConfigStrategyResult> | NodeBlockConfigStrategyResult;
    validate?(node: FlowNode, flow: FlowDocument): string[];

    // TODO(node-config): Add optional ordering or priority metadata so future
    // orchestration can intentionally sequence multiple strategies on the same
    // node instead of picking only one matching strategy.
}

export async function inferTaskType(userRequest: string, wantsJson: boolean): Promise<string> {
    const taskTypes = await getFlowDesignTaskTypeCatalog();
    return (
        await createFlowDesignTaskTypeAdvisor().recommend({
            userRequest,
            wantsJson,
            taskTypes,
        })
    ).taskType;
}

export async function inferTaskTypeWithInput(input: NodeConfigurationDesignInput): Promise<string> {
    const taskTypes = await getFlowDesignTaskTypeCatalog();
    return (
        await createFlowDesignTaskTypeAdvisor(input.llm).recommend({
            userRequest: input.userRequest,
            wantsJson: input.wantsJson,
            taskTypes,
        })
    ).taskType;
}

export async function ensureDesignBrief(input: NodeConfigurationDesignInput): Promise<DesignBrief> {
    if (input.designBrief) {
        return input.designBrief;
    }

    const analyzedIntent = await analyzeFlowRequest(input.userRequest, {
        taskTypeAdvisor: createFlowDesignTaskTypeAdvisor(input.llm),
        taskTypes: await getFlowDesignTaskTypeCatalog(),
    });

    return analyzedIntent.designBrief!;
}

export function collectStrategyNotes(input: NodeConfigurationDesignInput): string[] {
    return input.strategyNotes ?? [];
}

export function collectStrategyNotesFor(input: NodeConfigurationDesignInput, strategyId: string): string[] {
    // TODO(node-config): Preserve note provenance so UIs can explain whether a
    // strategy note came from reflection, block probing, or direct user input.
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
