// Runtime factory and public exports.
import { AgentRuntime, AgentRuntimeOptions } from './agent/runtime';
import { FakeLlmGateway } from './llm/fake-gateway';
import { GeminiGateway } from './llm/gemini-gateway';
import { OpenAiGateway } from './llm/openai-gateway';
import { InMemoryRunStateStore } from './state/memory-store';
import { buildDefaultToolRegistry } from './tools';

/** Creates the default runtime with fake, OpenAI, or Gemini-backed LLM wiring. */
export function createRuntime(options?: Partial<AgentRuntimeOptions>) {
    const provider = String(process.env.LLM_PROVIDER ?? '').toLowerCase();
    const useRealOpenAi = String(process.env.USE_REAL_OPENAI ?? 'false').toLowerCase() === 'true';
    const useRealGemini = String(process.env.USE_REAL_GEMINI ?? 'false').toLowerCase() === 'true';
    const llm =
        options?.llm ??
        (provider === 'gemini' || useRealGemini
            ? new GeminiGateway()
            : provider === 'openai' || useRealOpenAi
            ? new OpenAiGateway()
            : new FakeLlmGateway());
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
export * from './flow';
export * from './flow-agent';
export * from './graph';
export * from './llm/gemini-gateway';
export * from './llm/structured-schema';
