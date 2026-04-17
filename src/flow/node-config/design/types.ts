// Core contracts for node-level flow configuration design.
import type { FlowDocument } from '../../types';

/** Per-node configuration recommendation emitted by the node-config core. */
export interface NodeConfigurationSuggestion {
    nodeId: string;
    blockId: string;
    strategyId: string;
    config: Record<string, string>;
    rationale: string[];
}

/** Strategy-targeted improvement directive emitted by reflection or higher-level planners. */
export interface NodeConfigurationStrategyDirective {
    strategyId: string;
    note: string;
}

/** Observed runtime behavior for a probed block that can inform node configuration design. */
export interface NodeConfigurationProbeResult {
    blockId: string;
    observedOutputs?: Record<string, unknown>;
    observedLogs?: string[];
    behaviorNotes?: string[];
    mismatchesFromSpec?: string[];
}

/** Result returned after applying node-level configuration design. */
export interface NodeConfigurationDesignResult {
    flow: FlowDocument;
    suggestions: NodeConfigurationSuggestion[];
    probeInsightsApplied: string[];
    appliedStrategyIds: string[];
    nodeStrategyAssignments: Array<{
        nodeId: string;
        strategyId: string;
    }>;
    summary: string;
}

/** Validation output for configured flow nodes. */
export interface NodeConfigurationValidationResult {
    isValid: boolean;
    issues: string[];
}

/** Inputs accepted by the node-configuration design core. */
export interface NodeConfigurationDesignInput {
    userRequest: string;
    flow: FlowDocument;
    desiredCount: number;
    wantsJson: boolean;
    improvementNotes?: string[];
    strategyNotes?: string[];
    strategyDirectives?: NodeConfigurationStrategyDirective[];
    probeResult?: NodeConfigurationProbeResult;
}
