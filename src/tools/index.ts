// Tool metadata, registration, and mock implementations.
import { ToolRegistry } from './registry';
import { createMockTools } from './mock-tools';

/** Builds the default registry preloaded with all bundled mock tools. */
export function buildDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerMany(createMockTools());
  return registry;
}
