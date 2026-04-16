// Sub-agent that specializes in configuring flow nodes after the graph structure exists.
import { validateFlowNode } from '../flow/document';
import type { FlowDocument } from '../flow/types';
import { createDefaultNodeBlockConfigStrategies, type NodeBlockConfigStrategy } from './strategies';
import type {
    NodeConfigurationDesignInput,
    NodeConfigurationDesignResult,
    NodeConfigurationValidationResult,
} from './types';

/** Designs concrete per-node configuration values for an already-structured flow draft. */
export class NodeConfigDesignAgent {
    constructor(private readonly strategies: NodeBlockConfigStrategy[] = createDefaultNodeBlockConfigStrategies()) {}

    design(input: NodeConfigurationDesignInput): NodeConfigurationDesignResult {
        const probeInsightsApplied = [
            ...(input.probeResult?.behaviorNotes ?? []),
            ...(input.probeResult?.mismatchesFromSpec ?? []),
        ];
        const suggestions: NodeConfigurationDesignResult['suggestions'] = [];
        const nextFlow: FlowDocument = {
            ...input.flow,
            nodes: input.flow.nodes.map(node => {
                const strategy = this.strategies.find(
                    candidate =>
                        candidate.blockId === node.blockId && (candidate.supports ? candidate.supports(node) : true),
                );
                if (!strategy) {
                    return node;
                }

                const result = strategy.apply(node, {
                    flow: input.flow,
                    input,
                    probeInsightsApplied,
                });
                if (result.suggestion) {
                    suggestions.push(result.suggestion);
                }
                return result.node;
            }),
        };

        return {
            flow: nextFlow,
            suggestions,
            probeInsightsApplied,
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

            const strategy = this.strategies.find(candidate => candidate.blockId === node.blockId);
            if (strategy?.validate && (strategy.supports ? strategy.supports(node) : true)) {
                issues.push(...strategy.validate(node, flow));
            }
        }

        return {
            isValid: issues.length === 0,
            issues,
        };
    }
}
