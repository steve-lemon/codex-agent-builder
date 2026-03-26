// Tool metadata, registration, and mock implementations.
import { z, type ZodTypeAny } from 'zod';

export type ToolRiskLevel = 'read-only' | 'side-effecting' | 'approval-required';

export interface ToolContext {
  runId: string;
  now: string;
}

export interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  toolName: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  skipped?: boolean;
}

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
