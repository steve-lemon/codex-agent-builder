// Runtime factory and public exports.
import { AgentRuntime } from './agent/runtime';
import { FakeLlmGateway } from './llm/fake-gateway';
import { OpenAiGateway } from './llm/openai-gateway';
import { InMemoryRunStateStore } from './state/memory-store';
import { buildDefaultToolRegistry } from './tools';

export function createRuntime() {
  const useRealOpenAi = String(process.env.USE_REAL_OPENAI ?? 'false').toLowerCase() === 'true';
  const llm = useRealOpenAi ? new OpenAiGateway() : new FakeLlmGateway();

  return new AgentRuntime({
    llm,
    store: new InMemoryRunStateStore(),
    toolRegistry: buildDefaultToolRegistry()
  });
}

export * from './agent/runtime';
export * from './agent/types';
