// Runtime factory and public exports.
import { AgentRuntime, type AgentRuntimeOptions } from './agent';
import { FakeLlmGateway, GeminiGateway, OpenAiGateway } from './llm';
import { InMemoryRunStateStore } from './state/memory-store';
import { buildDefaultToolRegistry } from './tools';

/** Creates the default runtime with fake, OpenAI, or Gemini-backed LLM wiring. */
export async function createRuntime(options?: Partial<AgentRuntimeOptions>) {
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
    const toolRegistry = options?.toolRegistry ?? (await buildDefaultToolRegistry());

    return new AgentRuntime({
        llm,
        store,
        toolRegistry,
    });
}

// Shared runtime and result contracts.
export * from './agent';
// Flow graph/document runtime plus nested flow extensions.
export * from './flow';
export * from './graph';
// LLM gateways plus deterministic fake adapters.
export * from './llm';
// Product-facing facade APIs.
export * from './product';
// Observability and live runtime monitoring.
export * from './observability';
// Prompt improvement lab with interactive CLI-oriented product workflow.
export * from './prompt-lab';
