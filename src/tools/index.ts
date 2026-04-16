// Tool metadata, registration, and mock implementations.
import { ToolRegistry } from './registry';
import { createTaskGraphTools } from './task-graph-tools';
import { createFlowDesignTools } from './flow-tools';
import { createMockTools } from './mock-tools';
import { createNodeConfigTools } from './node-config-tools';

/** Builds the default registry preloaded with all bundled mock tools. */
export function buildDefaultToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();
    registry.registerMany([
        ...createMockTools(),
        ...createFlowDesignTools(),
        ...createNodeConfigTools(),
        ...createTaskGraphTools(),
    ]);
    return registry;
}
