// Helpers for building DTO-first final-result design details while keeping legacy fields for compatibility.
import { createEmptyFlowDesignDetailsDto, type FlowDesignDetailsDto } from '../flow-design/dto';
import { createEmptyNodeConfigDesignDetailsDto, type NodeConfigDesignDetailsDto } from '../node-config-design/dto';
import type { FinalResultDesignDetails } from './types';

/** Reads flow-design details through the DTO-first path and falls back to compatibility fields if needed. */
export function getFlowDesignDetails(details?: FinalResultDesignDetails): FlowDesignDetailsDto {
    return (
        details?.flowDesign ??
        createEmptyFlowDesignDetailsDto({
            improvements: details?.flowDesignImprovements ?? [],
        })
    );
}

/** Reads node-config details through the DTO-first path and falls back to compatibility fields if needed. */
export function getNodeConfigurationDetails(details?: FinalResultDesignDetails): NodeConfigDesignDetailsDto {
    return (
        details?.nodeConfiguration ??
        createEmptyNodeConfigDesignDetailsDto({
            improvements: details?.nodeConfigStrategyImprovements ?? [],
            appliedStrategies: details?.appliedNodeConfigStrategies ?? [],
            nodeStrategyAssignments: details?.nodeStrategyAssignments ?? [],
            configuredNodeCount: details?.configuredNodeCount ?? 0,
            probeInsightCount: details?.probeInsightCount ?? 0,
        })
    );
}

/** Builds a DTO-first design-details object and backfills legacy flat fields for compatibility. */
export function buildFinalResultDesignDetails(args: {
    flowDesign?: FlowDesignDetailsDto;
    nodeConfiguration?: NodeConfigDesignDetailsDto;
}): FinalResultDesignDetails {
    const flowDesign = args.flowDesign;
    const nodeConfiguration = args.nodeConfiguration;

    return {
        flowDesignImprovements: flowDesign?.improvements ?? [],
        nodeConfigStrategyImprovements: nodeConfiguration?.improvements ?? [],
        flowDesign,
        nodeConfiguration,
        appliedNodeConfigStrategies: nodeConfiguration?.appliedStrategies ?? [],
        nodeStrategyAssignments: nodeConfiguration?.nodeStrategyAssignments ?? [],
        configuredNodeCount: nodeConfiguration?.configuredNodeCount ?? 0,
        probeInsightCount: nodeConfiguration?.probeInsightCount ?? 0,
    };
}
