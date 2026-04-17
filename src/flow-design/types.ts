// Core contracts for flow design, validation, execution, and reflection.
import type { GraphExecutionPlan, GraphRunResult } from '../graph/types';
import type { FlowAiGenerateRequest } from '../flow/runtime';
import type { FlowDocument } from '../flow/types';

/** Coarse-grained task classification used by flow-design layers. */
export type FlowDesignTaskType = string;

/** Parsed intent derived from a natural-language user request. */
export interface FlowDesignIntent {
    userRequest: string;
    taskType: FlowDesignTaskType;
    taskTypeConfidence?: number;
    taskTypeRationale?: string;
    taskTypeSource?: 'deterministic' | 'model';
    wantsJson: boolean;
    wantsMultiple: boolean;
    desiredCount: number;
    sampleInput: string;
}

/** Validation summary for a designed flow draft. */
export interface FlowDesignValidation {
    isValid: boolean;
    issues: string[];
    plan?: GraphExecutionPlan;
}

/** Example execution result captured from a designed flow. */
export interface FlowDesignExecution {
    status: GraphRunResult['status'];
    flow: FlowDocument;
    output?: unknown;
    logs: string[];
    graphRun: GraphRunResult<string>;
}

/** Reflection result used to decide whether another design pass is warranted. */
export interface FlowDesignReflection {
    satisfied: boolean;
    summary: string;
    issues: string[];
    suggestedImprovements: string[];
    triggeredRuleIds?: string[];
}

/** Mapping between inferred task-graph nodes and the simplified flow draft. */
export interface FlowTaskGraphMapping {
    flowNodes: Array<{
        flowNodeId: string;
        taskNodeId?: string;
        taskNodeLabel?: string;
        role?: string;
    }>;
    taskEdges: Array<{
        source: string;
        target: string;
        label?: string;
    }>;
}

/** Structured result returned by core flow draft composition. */
export interface FlowDesignDraftResult {
    flow: FlowDocument;
    designRationale: string[];
    preflightSummary: {
        taskGraphNodeCount: number;
        feasible: boolean;
        missingCapabilities: string[];
    };
    taskGraphMapping: FlowTaskGraphMapping;
}

/** Extended AI request used by flow-design mock/runtime bridges. */
export interface FlowDesignAiGenerateRequest extends FlowAiGenerateRequest {
    iteration: number;
    userRequest: string;
    improvementNotes: string[];
}
