// Tool metadata, registration, and mock implementations.
import { z, type ZodTypeAny } from 'zod';
import type { RunStateContext } from '../state/types';

export type ToolRiskLevel = 'read-only' | 'side-effecting' | 'approval-required';

/** Runtime context injected into each tool call. */
export interface ToolContext {
  runId: string;
  now: number;
  runState: RunStateContext;
}

/** Generic tool call envelope used across planning and execution. */
export interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

/** Structured tool execution result returned by the registry. */
export interface ToolResult {
  toolName: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  skipped?: boolean;
}

/** Tool definition plus metadata used by routing, policy, and execution layers. */
export interface ToolDefinition<TSchema extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  parameters: TSchema;
  riskLevel: ToolRiskLevel;
  allowedSkills: string[];
  requiresConfirmation: boolean;
  parallelSafe: boolean;
  execute: (
    args: z.infer<TSchema>,
    context: ToolContext
  ) => Promise<unknown> | unknown;
}
