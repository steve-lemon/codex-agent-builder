// Agent runtime flow and data contracts.
import type { ApprovalDecision, PendingApproval, StepResult } from './types';

/** Creates the persisted approval payload for a tool call that must pause execution. */
export function buildPendingApproval(stepIndex: number, toolName: string, args: Record<string, unknown>): PendingApproval {
  return {
    stepIndex,
    toolCall: { toolName, args },
    reason: `Tool ${toolName} requires confirmation`
  };
}

/** Converts an operator decision into executable args or a synthetic rejection result. */
export function resolveApprovalArgs(
  pending: PendingApproval,
  decision: ApprovalDecision
): { approved: boolean; args: Record<string, unknown>; syntheticResult?: StepResult } {
  if (decision.decision === 'reject') {
    return {
      approved: false,
      args: pending.toolCall.args,
      syntheticResult: {
        stepId: `approval-${pending.stepIndex}`,
        mode: 'single-tool',
        output: { approved: false, reason: 'Rejected by operator' },
        toolResults: [
          {
            toolName: pending.toolCall.toolName,
            ok: false,
            skipped: true,
            error: 'Rejected by operator'
          }
        ]
      }
    };
  }

  if (decision.decision === 'edit-and-approve') {
    return {
      approved: true,
      args: decision.editedArgs ?? pending.toolCall.args
    };
  }

  return {
    approved: true,
    args: pending.toolCall.args
  };
}
