// Tool metadata, registration, and mock implementations.
import { ToolRegistry } from './registry';
import { createMockTools } from './mock-tools';

export function buildDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerMany(createMockTools());
  return registry;
}
