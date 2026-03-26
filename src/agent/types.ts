// Agent runtime flow and data contracts.
import { z } from 'zod';
import type { ToolCall, ToolResult, ToolRiskLevel } from '../tools/types';
import type { Plan, PlanStep } from './schemas';
import type { TraceEvent } from '../observability/types';
import type { RunStateContext } from '../state/types';

export type RunStatus =
  | 'idle'
  | 'running'
  | 'waiting_for_approval'
  | 'completed'
  | 'failed';

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

/** Durable runtime state used for persistence, tracing, and resume flow. */
export interface RunState {
  runId: string;
  userInput: string;
  skillName: string;
  skillInstructions: string;
  allowedTools: string[];
  plan: Plan;
  currentStepIndex: number;
  stepResults: StepResult[];
  pendingApproval?: PendingApproval;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
}

/** Final structured response returned to the caller. */
export interface FinalResult {
  summary: string;
  success: boolean;
  nextActions: string[];
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
  nextActions: z.array(z.string())
});

/** Execution metadata passed into step execution. */
export interface ExecuteStepContext {
  runId: string;
  stepIndex: number;
  allowParallel: boolean;
  runState: RunStateContext;
}

/** Concrete timeout and retry settings resolved for a tool. */
export interface ToolExecutionPolicy {
  riskLevel: ToolRiskLevel;
  maxAttempts: number;
  timeoutMs: number;
  useCircuitBreaker: boolean;
}
