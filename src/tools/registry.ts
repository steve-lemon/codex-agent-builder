// Tool metadata, registration, and mock implementations.
import { z } from 'zod';
import type { ToolCall, ToolDefinition, ToolResult } from './types';

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
    return this.list().filter((t) => t.allowedSkills.includes(skillName));
  }

  parseArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
    const tool = this.get(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }
    const parsed = tool.parameters.safeParse(args);
    if (!parsed.success) {
      throw new Error(
        `Invalid args for ${toolName}: ${parsed.error.issues
          .map((i) => i.message)
          .join(', ')}`
      );
    }
    return parsed.data as Record<string, unknown>;
  }

  async execute(call: ToolCall, runId: string): Promise<ToolResult> {
    const tool = this.get(call.toolName);
    if (!tool) {
      return { toolName: call.toolName, ok: false, error: 'Tool not found' };
    }

    try {
      const parsedArgs = this.parseArgs(call.toolName, call.args);
      const data = await tool.execute(parsedArgs, {
        runId,
        now: new Date().toISOString()
      });
      return { toolName: call.toolName, ok: true, data };
    } catch (error) {
      return {
        toolName: call.toolName,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

export const AnyArgsSchema = z.record(z.unknown());
