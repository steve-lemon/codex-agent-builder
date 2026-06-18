// Tool metadata, registration, and mock implementations.
import { ToolRegistry } from './core/registry';
import type { ToolPack, ToolRepositoryBundle } from './core/types';
import { getLlmRuntimeManifest } from '../llm/runtime-manifest';
import { createTaskGraphToolPack } from '../flow/agent/preflight-tools';
import { createFlowDesignToolPack } from '../flow/agent/tools';
import { createMockToolPack } from '../agent/sample-tools';
import { createNodeConfigToolPack } from '../flow/node-config/agent/tools';
import type { ToolResourceId } from './core/resources';

const DEFAULT_TOOL_PACK_LOADERS: Record<ToolResourceId, () => Promise<ToolPack | ToolRepositoryBundle>> = {
    'tools.sample-tools.set': createMockToolPack,
    'tools.flow-design.set': createFlowDesignToolPack,
    'tools.node-config.set': createNodeConfigToolPack,
    'tools.task-graph.set': createTaskGraphToolPack,
};
// TODO(tools): Move this loader map behind a dedicated tool-pack registry so new
// pack implementations can register themselves without editing buildDefaultToolRegistry().

/** Builds the default registry by loading each resource-backed tool pack and registering its bundle. */
export async function buildDefaultToolRegistry(): Promise<ToolRegistry> {
    const registry = new ToolRegistry();
    const { defaultToolPackIds } = await getLlmRuntimeManifest();

    for (const id of defaultToolPackIds) {
        const loadPack = DEFAULT_TOOL_PACK_LOADERS[id as ToolResourceId];
        if (!loadPack) {
            throw new Error(`No default tool-pack loader registered for resource id: ${id}`);
        }
        registry.registerPack((await loadPack()) as ToolPack);
    }

    return registry;
}

export * from './core';
