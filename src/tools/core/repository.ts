import { z } from 'zod';
import { AgentError } from '../../errors/agent-error';
import type {
    ToolCall,
    ToolContext,
    ToolDefinition,
    ToolExecutorMap,
    ToolPack,
    ToolRepositoryBundle,
    ToolResult,
} from './types';

/** Stores tool metadata separately from executor functions, then resolves execution by id. */
export class ToolRepository {
    private readonly tools = new Map<string, ToolDefinition>();
    private readonly executors = new Map<string, ToolExecutorMap[string]>();
    private readonly packs = new Map<string, ToolPack>();

    register(tool: ToolDefinition): void {
        const executeId = tool.executeId ?? tool.name;
        this.tools.set(tool.name, { ...tool, executeId });

        if (tool.execute) {
            this.executors.set(executeId, tool.execute as ToolExecutorMap[string]);
        }
    }

    registerMany(tools: ToolDefinition[]): void {
        for (const tool of tools) {
            this.register(tool);
        }
    }

    registerExecutor(executeId: string, executor: ToolExecutorMap[string]): void {
        this.executors.set(executeId, executor);
    }

    registerExecutors(executors: ToolExecutorMap): void {
        for (const [executeId, executor] of Object.entries(executors)) {
            this.registerExecutor(executeId, executor);
        }
    }

    registerBundle(bundle: ToolRepositoryBundle): void {
        this.registerMany(bundle.tools);
        this.registerExecutors(bundle.executors);
    }

    registerPack(pack: ToolPack): void {
        this.packs.set(pack.id, pack);
        this.registerBundle(pack.bundle);
    }

    listPacks(): ToolPack[] {
        return Array.from(this.packs.values());
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

        const executeId = tool.executeId ?? tool.name;
        const executor = this.executors.get(executeId);
        if (!executor) {
            return { toolName: call.toolName, ok: false, error: `Executor not found: ${executeId}` };
        }

        try {
            const parsedArgs = this.parseArgs(call.toolName, call.args);
            const data = await executor(parsedArgs, context);
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

export const AnyArgsSchema = z.record(z.unknown());
