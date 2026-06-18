// Resource-backed block and capability catalog used by flow-design layers.
import {
    getAvailableFlowCapabilities as getAvailableFlowCapabilitiesFromPool,
    getBuiltinFlowBlocks,
    getFlowBlockCapabilityMap as getFlowBlockCapabilityMapFromPool,
} from '../block-pool';

/** Built-in blocks currently available to flow-related design agents and tools. */
export async function getCatalogAvailableFlowBlocks() {
    return await getBuiltinFlowBlocks();
}

/** Coarse capability registry currently exposed by the built-in block pool. */
export async function getCatalogAvailableFlowCapabilities() {
    return await getAvailableFlowCapabilitiesFromPool();
}

/** Capability map used for deterministic task-graph to block matching. */
export async function getCatalogFlowBlockCapabilityMap() {
    return await getFlowBlockCapabilityMapFromPool();
}
