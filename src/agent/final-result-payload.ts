// Helpers for building skill-specific final-result payload DTOs.
import type {
    FinalResultSkillPayload,
    FlowDesignerFinalPayload,
    FlowPreflightValidatorFinalPayload,
    NodeConfigDesignerFinalPayload,
} from './types';

/** Builds a payload for `flow-preflight-validator` results. */
export function buildFlowPreflightValidatorPayload(args: {
    feasible: boolean;
    missingCapabilities?: string[];
    proposedBlockIds?: string[];
}): FlowPreflightValidatorFinalPayload {
    return {
        kind: 'flow-preflight-validator',
        feasible: args.feasible,
        missingCapabilities: args.missingCapabilities ?? [],
        proposedBlockIds: args.proposedBlockIds ?? [],
    };
}

/** Builds a payload for `node-config-designer` results. */
export function buildNodeConfigDesignerPayload(args?: {
    requiresExistingFlowDraft?: boolean;
    suggestedNextTools?: string[];
}): NodeConfigDesignerFinalPayload {
    return {
        kind: 'node-config-designer',
        requiresExistingFlowDraft: args?.requiresExistingFlowDraft ?? true,
        suggestedNextTools: args?.suggestedNextTools ?? [],
    };
}

/** Builds a payload for `flow-designer` results. */
export function buildFlowDesignerPayload(args: {
    feasible: boolean;
    designPassCount?: number;
    taskGraphRefinementCount?: number;
    configuredNodeCount?: number;
    probeInsightCount?: number;
    missingCapabilities?: string[];
}): FlowDesignerFinalPayload {
    return {
        kind: 'flow-designer',
        feasible: args.feasible,
        designPassCount: args.designPassCount ?? 0,
        taskGraphRefinementCount: args.taskGraphRefinementCount ?? 0,
        configuredNodeCount: args.configuredNodeCount ?? 0,
        probeInsightCount: args.probeInsightCount ?? 0,
        missingCapabilities: args.missingCapabilities ?? [],
    };
}

/** Returns the flow-designer payload when present. */
export function getFlowDesignerPayload(payload?: FinalResultSkillPayload): FlowDesignerFinalPayload | undefined {
    return payload?.kind === 'flow-designer' ? payload : undefined;
}

/** Returns the flow-preflight payload when present. */
export function getFlowPreflightValidatorPayload(
    payload?: FinalResultSkillPayload,
): FlowPreflightValidatorFinalPayload | undefined {
    return payload?.kind === 'flow-preflight-validator' ? payload : undefined;
}

/** Returns the node-config payload when present. */
export function getNodeConfigDesignerPayload(
    payload?: FinalResultSkillPayload,
): NodeConfigDesignerFinalPayload | undefined {
    return payload?.kind === 'node-config-designer' ? payload : undefined;
}
