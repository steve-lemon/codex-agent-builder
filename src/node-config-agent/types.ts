// Contracts for the node-configuration design sub-agent.
import type { FlowDocument } from '../flow/types';

/** Per-node configuration recommendation emitted by the sub-agent. */
export interface NodeConfigurationSuggestion {
    nodeId: string;
    blockId: string;
    config: Record<string, string>;
    rationale: string[];
}

/** Result returned after applying node-level configuration design. */
export interface NodeConfigurationDesignResult {
    flow: FlowDocument;
    suggestions: NodeConfigurationSuggestion[];
    summary: string;
}

/** Validation output for configured flow nodes. */
export interface NodeConfigurationValidationResult {
    isValid: boolean;
    issues: string[];
}

/** Inputs accepted by the node-configuration design sub-agent. */
export interface NodeConfigurationDesignInput {
    userRequest: string;
    flow: FlowDocument;
    desiredCount: number;
    wantsJson: boolean;
    improvementNotes?: string[];
}
