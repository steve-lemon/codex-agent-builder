// Shared contracts and helpers for block-specific node-configuration strategies.
import type { FlowDocument, FlowNode } from '../../../types';
import { normalizeFlowRequest } from '../../../design/core';
import { buildDesignBrief } from '../../../design/architecture';
import { createFlowDesignTaskTypeAdvisor, getFlowDesignTaskTypeCatalog } from '../../../design/task-types';
import { createFlowOutputContractAdvisor } from '../../../output-contract';
import type { DesignBrief } from '../../../design/types';
import type { NodeConfigurationDesignInput, NodeConfigurationSuggestion } from '../types';

const designBriefCache = new WeakMap<NodeConfigurationDesignInput, Promise<DesignBrief>>();
const taskTypeCache = new WeakMap<NodeConfigurationDesignInput, Promise<string>>();
// TODO(node-config): designFlowNodeConfigurations is no longer timing out, but it is still
// one of the most expensive tool stages in successful prompt-lab runs. The next optimization
// pass should measure and trim:
// 1) repeated manifest/resource lookups inside strategy application,
// 2) oversized strategy notes/directives payloads,
// 3) unnecessary task-type inference when a design brief already implies a stable operation model.

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
    const cached = taskTypeCache.get(input);
    if (cached) {
        return await cached;
    }

    const pending = (async () => {
        const taskTypes = await getFlowDesignTaskTypeCatalog();
        return (
            await createFlowDesignTaskTypeAdvisor(input.llm).recommend({
                userRequest: input.userRequest,
                wantsJson: input.wantsJson,
                taskTypes,
            })
        ).taskType;
    })();

    taskTypeCache.set(input, pending);
    return await pending;
}

export async function ensureDesignBrief(input: NodeConfigurationDesignInput): Promise<DesignBrief> {
    if (input.designBrief) {
        return input.designBrief;
    }

    const cached = designBriefCache.get(input);
    if (cached) {
        return await cached;
    }

    const pending = (async () => {
        const normalizedRequest = await normalizeFlowRequest(input.userRequest, {
            taskTypeAdvisor: createFlowDesignTaskTypeAdvisor(input.llm),
            outputContractAdvisor: createFlowOutputContractAdvisor(input.llm),
            taskTypes: await getFlowDesignTaskTypeCatalog(),
        });

        return await buildDesignBrief(normalizedRequest);
    })();

    designBriefCache.set(input, pending);
    return await pending;
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
