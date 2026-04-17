import type { ZodType } from 'zod';
import { type FlowDesignManifestRecord, FlowDesignManifestSchema } from '../flow-design/manifest-schemas';
import {
    type NodeConfigDesignManifestRecord,
    NodeConfigDesignManifestSchema,
} from '../node-config-design/manifest-schemas';
import { type LlmRuntimeManifestRecord, LlmRuntimeManifestSchema } from '../llm/runtime-manifest-schemas';

export interface ResourceDefinition<T> {
    id: string;
    relativePath: string;
    schema: ZodType<T>;
}

export interface ResourceSchemaMap {
    'flow-design.manifest': FlowDesignManifestRecord;
    'node-config-design.manifest': NodeConfigDesignManifestRecord;
    'llm.runtime.manifest': LlmRuntimeManifestRecord;
}

export type ResourceId = keyof ResourceSchemaMap;

export const RESOURCE_DEFINITIONS: {
    [K in ResourceId]: ResourceDefinition<ResourceSchemaMap[K]>;
} = {
    'flow-design.manifest': {
        id: 'flow-design.manifest',
        relativePath: 'skills/flow-designer/FLOW_DESIGN_MANIFEST.yml',
        schema: FlowDesignManifestSchema,
    },
    'node-config-design.manifest': {
        id: 'node-config-design.manifest',
        relativePath: 'skills/node-config-designer/NODE_CONFIG_MANIFEST.yml',
        schema: NodeConfigDesignManifestSchema,
    },
    'llm.runtime.manifest': {
        id: 'llm.runtime.manifest',
        relativePath: 'runtime/LLM_RUNTIME_MANIFEST.yml',
        schema: LlmRuntimeManifestSchema,
    },
};

export function getResourceDefinition<K extends ResourceId>(id: K): ResourceDefinition<ResourceSchemaMap[K]> {
    // TODO(resources): Extend resource definitions with manifest version / migration metadata
    // so older deployed manifests can be upgraded explicitly instead of failing schema validation.
    return RESOURCE_DEFINITIONS[id];
}
