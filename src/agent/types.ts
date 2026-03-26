// Agent runtime flow and data contracts.
import { z } from 'zod';
import type { ToolCall, ToolResult, ToolRiskLevel } from '../tools/types';
import type { Plan, PlanStep } from './schemas';
import type { TraceEvent } from '../observability/types';

export type RunStatus =
  | 'idle'
  | 'running'
  | 'waiting_for_approval'
  | 'completed'
  | 'failed';

export type ApprovalDecisionType = 'approve' | 'reject' | 'edit-and-approve';

export interface ApprovalDecision {
  decision: ApprovalDecisionType;
  editedArgs?: Record<string, unknown>;
}

export interface PendingApproval {
  stepIndex: number;
  toolCall: ToolCall;
  reason: string;
}

export interface StepResult {
  stepId: string;
  mode: PlanStep['mode'];
  output: unknown;
  toolResults?: ToolResult[];
}

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
  createdAt: string;
  updatedAt: string;
}

export interface FinalResult {
  summary: string;
  success: boolean;
  nextActions: string[];
}

export interface RuntimeRunResult {
  runId: string;
  status: RunStatus;
  finalResult?: FinalResult;
  waitingApproval?: PendingApproval;
  trace: TraceEvent[];
}

export const FinalResultSchema = z.object({
  summary: z.string(),
  success: z.boolean(),
  nextActions: z.array(z.string())
});

export interface ExecuteStepContext {
  runId: string;
  stepIndex: number;
  allowParallel: boolean;
}

export interface ToolExecutionPolicy {
  riskLevel: ToolRiskLevel;
  maxAttempts: number;
  timeoutMs: number;
  useCircuitBreaker: boolean;
}
