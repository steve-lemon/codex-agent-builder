// Tool metadata, registration, and mock implementations.
import { ToolRegistry } from './registry';
import { createTaskGraphToolPack } from './task-graph-tools';
import { createFlowDesignToolPack } from './flow-tools';
import { createMockToolPack } from './mock-tools';
import { createNodeConfigToolPack } from './node-config-tools';

/** Builds the default registry by loading each resource-backed tool pack and registering its bundle. */
export async function buildDefaultToolRegistry(): Promise<ToolRegistry> {
    const registry = new ToolRegistry();
    registry.registerPack(await createMockToolPack());
    registry.registerPack(await createFlowDesignToolPack());
    registry.registerPack(await createNodeConfigToolPack());
    registry.registerPack(await createTaskGraphToolPack());
    return registry;
}
