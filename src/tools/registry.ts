// Tool metadata, registration, and mock implementations.
import { z } from 'zod';
import type { ToolCall, ToolDefinition, ToolResult } from './types';
import { AgentError } from '../errors/agent-error';
import type { ToolContext } from './types';

/** Stores tool definitions and provides argument validation plus execution helpers. */
export class ToolRegistry {
    private readonly tools = new Map<string, ToolDefinition>();

    register(tool: ToolDefinition): void {
        this.tools.set(tool.name, tool);
    }

    registerMany(tools: ToolDefinition[]): void {
        for (const tool of tools) {
            this.register(tool);
        }
    }

    get(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    list(): ToolDefinition[] {
        return Array.from(this.tools.values());
    }

    listBySkills(skillName: string): ToolDefinition[] {
        return this.list().filter(t => t.allowedSkills.includes(skillName));
    }

    parseArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
        const tool = this.get(toolName);
        if (!tool) {
            throw new AgentError(`Tool not found: ${toolName}`);
        }
        const parsed = tool.parameters.safeParse(args);
        if (!parsed.success) {
            throw new AgentError(`Invalid args for ${toolName}: ${parsed.error.issues.map(i => i.message).join(', ')}`);
        }
        return parsed.data as Record<string, unknown>;
    }

    async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
        const tool = this.get(call.toolName);
        if (!tool) {
            return { toolName: call.toolName, ok: false, error: 'Tool not found' };
        }

        try {
            const parsedArgs = this.parseArgs(call.toolName, call.args);
            const data = await tool.execute(parsedArgs, context);
            return { toolName: call.toolName, ok: true, data };
        } catch (error) {
            const agentError = AgentError.from(error);
            return {
                toolName: call.toolName,
                ok: false,
                error: agentError.message,
            };
        }
    }
}

/** Fallback schema for generic tool arguments with unknown field shapes. */
export const AnyArgsSchema = z.record(z.string(), z.unknown());
