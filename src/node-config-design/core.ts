// Shared node-configuration design core used by wrappers and tools.
import { validateFlowNode } from '../flow/document';
import type { FlowDocument, FlowNode } from '../flow/types';
import { createDefaultNodeBlockConfigStrategies, type NodeBlockConfigStrategy } from '../node-config-agent/strategies';
import type { NodeConfigKnowledgeSource } from './knowledge';
import { createDefaultNodeConfigKnowledgeSource } from './knowledge-sources';
import type {
    NodeConfigurationDesignInput,
    NodeConfigurationDesignResult,
    NodeConfigurationValidationResult,
} from './types';

/** Shared node-configuration service that applies block-specific strategies to a flow draft. */
export class NodeConfigDesignService {
    constructor(
        private readonly strategies: NodeBlockConfigStrategy[] = createDefaultNodeBlockConfigStrategies(),
        private readonly knowledgeSource: NodeConfigKnowledgeSource = createDefaultNodeConfigKnowledgeSource(),
    ) {}

    resolveStrategy(flow: FlowDocument, node: FlowNode): NodeBlockConfigStrategy | undefined {
        const block = flow.blocks.find(candidate => candidate.id === node.blockId);
        const preferredStrategyId = block?.nodeConfigStrategyId;
        const hasExplicitPreferredStrategy = preferredStrategyId
            ? this.strategies.some(
                  candidate => candidate.blockId === node.blockId && candidate.strategyId === preferredStrategyId,
              )
            : false;

        // TODO(node-config): Allow multiple strategies to cooperate on one node
        // when blocks eventually need layered configuration passes such as
        // provider selection + prompt shaping + output schema enforcement.
        return this.strategies.find(candidate => {
            if (candidate.blockId !== node.blockId) {
                return false;
            }
            if (hasExplicitPreferredStrategy && candidate.strategyId !== preferredStrategyId) {
                return false;
            }
            return candidate.supports ? candidate.supports(node) : true;
        });
    }

    async design(input: NodeConfigurationDesignInput): Promise<NodeConfigurationDesignResult> {
        const enrichedInput: NodeConfigurationDesignInput = {
            ...input,
            strategyNotes: [
                ...(input.strategyNotes ?? []),
                ...(await Promise.resolve(this.knowledgeSource.getSharedNotes(input))),
            ],
            strategyDirectives: [
                ...(input.strategyDirectives ?? []),
                ...(await Promise.resolve(this.knowledgeSource.getStrategyDirectives(input))),
            ],
        };
        const probeInsightsApplied = [
            ...(enrichedInput.probeResult?.behaviorNotes ?? []),
            ...(enrichedInput.probeResult?.mismatchesFromSpec ?? []),
        ];
        const suggestions: NodeConfigurationDesignResult['suggestions'] = [];
        const nodeStrategyAssignments: NodeConfigurationDesignResult['nodeStrategyAssignments'] = [];
        const nextFlow: FlowDocument = {
            ...enrichedInput.flow,
            nodes: await Promise.all(
                enrichedInput.flow.nodes.map(async node => {
                    const strategy = this.resolveStrategy(enrichedInput.flow, node);
                    if (!strategy) {
                        return node;
                    }

                    const result = await Promise.resolve(
                        strategy.apply(node, {
                            flow: enrichedInput.flow,
                            input: enrichedInput,
                            probeInsightsApplied,
                        }),
                    );
                    if (result.suggestion) {
                        suggestions.push(result.suggestion);
                        nodeStrategyAssignments.push({
                            nodeId: node.id,
                            strategyId: result.suggestion.strategyId,
                        });
                    }
                    return result.node;
                }),
            ),
        };
        const appliedStrategyIds = [...new Set(nodeStrategyAssignments.map(assignment => assignment.strategyId))];

        return {
            flow: nextFlow,
            suggestions,
            probeInsightsApplied,
            appliedStrategyIds,
            nodeStrategyAssignments,
            summary:
                probeInsightsApplied.length > 0
                    ? `Configured ${suggestions.length} node(s) with block-specific settings using ${probeInsightsApplied.length} probe insight(s).`
                    : `Configured ${suggestions.length} node(s) with block-specific settings.`,
        };
    }

    validate(flow: FlowDocument): NodeConfigurationValidationResult {
        const issues: string[] = [];

        for (const node of flow.nodes) {
            const validation = validateFlowNode(flow, node.id);
            issues.push(...validation.issues.map(issue => issue.message));

            const strategy = this.resolveStrategy(flow, node);
            if (strategy?.validate) {
                issues.push(...strategy.validate(node, flow));
            }
        }

        return {
            isValid: issues.length === 0,
            issues,
        };
    }
}
