// DTO builders for node-config design results used by UI and persistence boundaries.

/** Compact DTO for node-config design details. */
export interface NodeConfigDesignDetailsDto {
    improvements: string[];
    appliedStrategies: string[];
    nodeStrategyAssignments: Array<{
        nodeId: string;
        strategyId: string;
    }>;
    configuredNodeCount: number;
    probeInsightCount: number;
}

/** Converts a node-config design result into a stable DTO for higher layers. */
export function toNodeConfigDesignDetailsDto(
    result: {
        appliedStrategyIds?: string[];
        nodeStrategyAssignments?: Array<{
            nodeId: string;
            strategyId: string;
        }>;
        suggestions?: Array<unknown>;
        probeInsightsApplied?: string[];
    },
    improvements: string[] = [],
): NodeConfigDesignDetailsDto {
    return {
        improvements,
        appliedStrategies: result.appliedStrategyIds ?? [],
        nodeStrategyAssignments: result.nodeStrategyAssignments ?? [],
        configuredNodeCount: result.suggestions?.length ?? 0,
        probeInsightCount: result.probeInsightsApplied?.length ?? 0,
    };
}
