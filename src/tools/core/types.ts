// Tool metadata, registration, and mock implementations.
import { z, type ZodTypeAny } from 'zod';
import type { RunStateContext } from '../../state/types';
import { serializeZodSchema } from '../../schema/json-schema';
import type { FlowDesignConnection } from '../../flow/design-monitor';
import type { LlmGateway } from '../../llm/types';

export type ToolRiskLevel = 'read-only' | 'side-effecting' | 'approval-required';
type ToolExecutor<TArgs> = {
    bivarianceHack(args: TArgs, context: ToolContext): Promise<unknown> | unknown;
}['bivarianceHack'];

export type AnyToolExecutor = (args: Record<string, unknown>, context: ToolContext) => Promise<unknown> | unknown;

export type ToolExecutorMap = Record<string, AnyToolExecutor>;

export type ToolPackId = string;
export type ToolPackScope = 'agent-owned' | 'sample-only' | 'shared';

/** Runtime context injected into each tool call. */
export interface ToolContext {
    runId: string;
    now: number;
    runState: RunStateContext;
    designConnection?: FlowDesignConnection;
    llm?: LlmGateway;
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

/** Serializable tool spec exposed to the planner so it can ground tool-call arguments. */
export interface ToolManifest {
    name: string;
    description: string;
    parametersJsonSchema: Record<string, unknown>;
    riskLevel: ToolRiskLevel;
    requiresConfirmation: boolean;
    parallelSafe: boolean;
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
    executeId?: string;
    execute?: ToolExecutor<z.infer<TSchema>>;
}

export interface ToolRepositoryBundle {
    tools: ToolDefinition[];
    executors: ToolExecutorMap;
}

/**
 * Describes a domain- or skill-oriented pack of tools that can be registered together.
 * The bundle carries the actual tool metadata and executor mappings.
 */
export interface ToolPack {
    id: ToolPackId;
    version: number;
    name: string;
    description: string;
    owner: string;
    scope: ToolPackScope;
    skills: string[];
    bundle: ToolRepositoryBundle;
}

/** Preserves tool parameter inference when defining registry entries. */
export function defineTool<TSchema extends ZodTypeAny>(tool: ToolDefinition<TSchema>): ToolDefinition<TSchema> {
    return tool;
}

/** Builds the planner-facing manifest from a concrete tool definition. */
export function buildToolManifest(tool: ToolDefinition): ToolManifest {
    return {
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: serializeZodSchema(`${tool.name}_args`, tool.parameters),
        riskLevel: tool.riskLevel,
        requiresConfirmation: tool.requiresConfirmation,
        parallelSafe: tool.parallelSafe,
    };
}
