// Runtime factory and public exports.
import { AgentRuntime, AgentRuntimeOptions } from './agent/runtime';
import { FakeLlmGateway } from './llm/fake-gateway';
import { OpenAiGateway } from './llm/openai-gateway';
import { InMemoryRunStateStore } from './state/memory-store';
import { buildDefaultToolRegistry } from './tools';

/** Creates the default runtime with fake or OpenAI-backed LLM wiring. */
export function createRuntime(options?: Partial<AgentRuntimeOptions>) {
    const useRealOpenAi = String(process.env.USE_REAL_OPENAI ?? 'false').toLowerCase() === 'true';
    const llm = options?.llm ?? (useRealOpenAi ? new OpenAiGateway() : new FakeLlmGateway());
    const store = options?.store ?? new InMemoryRunStateStore();
    const toolRegistry = options?.toolRegistry ?? buildDefaultToolRegistry();

    return new AgentRuntime({
        llm,
        store,
        toolRegistry,
    });
}

export * from './agent/runtime';
export * from './agent/types';
