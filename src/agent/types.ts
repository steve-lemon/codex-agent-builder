// Agent runtime flow and data contracts.
import { z } from 'zod';
import type { FlowDesignDetailsDto } from '../flow-design/dto';
import type { NodeConfigDesignDetailsDto } from '../node-config-design/dto';
import type { ToolCall, ToolResult, ToolRiskLevel } from '../tools/types';
import type { Plan, PlanStep } from './schemas';
import type { TraceEvent } from '../observability/types';
import type { RunStateContext } from '../state/types';
import type { FlowDesignConnection } from '../flow/design-monitor';

export type RunStatus = 'idle' | 'running' | 'waiting_for_approval' | 'completed' | 'failed';

export type ApprovalDecisionType = 'approve' | 'reject' | 'edit-and-approve';

/** Operator decision used to continue a suspended run. */
export interface ApprovalDecision {
    decision: ApprovalDecisionType;
    editedArgs?: Record<string, unknown>;
}

/** Approval checkpoint captured when a tool call requires human confirmation. */
export interface PendingApproval {
    stepIndex: number;
    toolCall: ToolCall;
    reason: string;
}

/** Persisted output for a single executed step. */
export interface StepResult {
    stepId: string;
    mode: PlanStep['mode'];
    output: unknown;
    toolResults?: ToolResult[];
}

/** Child record used to persist a step result outside the main run state object. */
export interface RunStateResult {
    id: string;
    runId: string;
    resultNo: number;
    stepResult: StepResult;
    createdAt: number;
}

/** Durable runtime state used for persistence, tracing, and resume flow. */
export interface RunState {
    runId: string;
    traceId: string;
    userInput: string;
    skillName: string;
    skillInstructions: string;
    allowedTools: string[];
    plan: Plan;
    currentStepIndex: number;
    resultNo: number;
    stepResults: StepResult[];
    pendingApproval?: PendingApproval;
    status: RunStatus;
    createdAt: number;
    updatedAt: number;
}

/** Final structured response returned to the caller. */
export interface FinalResultDesignDetails {
    flowDesignImprovements: string[];
    nodeConfigStrategyImprovements: string[];
    flowDesign?: FlowDesignDetailsDto;
    nodeConfiguration?: NodeConfigDesignDetailsDto;
    appliedNodeConfigStrategies?: string[];
    nodeStrategyAssignments?: Array<{
        nodeId: string;
        strategyId: string;
    }>;
    configuredNodeCount?: number;
    probeInsightCount?: number;
}

/** Final structured response returned to the caller. */
export interface FinalResult {
    summary: string;
    success: boolean;
    nextActions: string[];
    designDetails?: FinalResultDesignDetails;
}

/** Top-level result returned by `run` and `resume`. */
export interface RuntimeRunResult {
    runId: string;
    status: RunStatus;
    finalResult?: FinalResult;
    waitingApproval?: PendingApproval;
    trace: TraceEvent[];
}

/** Schema used to validate the final structured response contract. */
export const FinalResultSchema = z.object({
    summary: z.string(),
    success: z.boolean(),
    nextActions: z.array(z.string()),
    designDetails: z
        .object({
            flowDesignImprovements: z.array(z.string()),
            nodeConfigStrategyImprovements: z.array(z.string()),
            flowDesign: z
                .object({
                    improvements: z.array(z.string()),
                    feasible: z.boolean(),
                    missingCapabilities: z.array(z.string()),
                    designPassCount: z.number().int().nonnegative(),
                    taskGraphRefinementCount: z.number().int().nonnegative(),
                })
                .optional(),
            nodeConfiguration: z
                .object({
                    improvements: z.array(z.string()),
                    appliedStrategies: z.array(z.string()),
                    nodeStrategyAssignments: z.array(
                        z.object({
                            nodeId: z.string(),
                            strategyId: z.string(),
                        }),
                    ),
                    configuredNodeCount: z.number().int().nonnegative(),
                    probeInsightCount: z.number().int().nonnegative(),
                })
                .optional(),
            appliedNodeConfigStrategies: z.array(z.string()).optional(),
            nodeStrategyAssignments: z
                .array(
                    z.object({
                        nodeId: z.string(),
                        strategyId: z.string(),
                    }),
                )
                .optional(),
            configuredNodeCount: z.number().int().nonnegative().optional(),
            probeInsightCount: z.number().int().nonnegative().optional(),
        })
        .optional(),
});

/** Execution metadata passed into step execution. */
export interface ExecuteStepContext {
    runId: string;
    stepIndex: number;
    allowParallel: boolean;
    runState: RunStateContext;
    designConnection?: FlowDesignConnection;
}

/** Concrete timeout and retry settings resolved for a tool. */
export interface ToolExecutionPolicy {
    riskLevel: ToolRiskLevel;
    maxAttempts: number;
    timeoutMs: number;
    useCircuitBreaker: boolean;
}
