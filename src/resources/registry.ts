import type { ZodType } from 'zod';
import { type FlowDesignManifestRecord, FlowDesignManifestSchema } from '../flow/design/manifest-schemas';
import {
    type NodeConfigDesignManifestRecord,
    NodeConfigDesignManifestSchema,
} from '../flow/node-config/design/manifest-schemas';
import { type LlmRuntimeManifestRecord, LlmRuntimeManifestSchema } from '../llm/runtime-manifest-schemas';
import { type ToolPackResourceRecord, ToolPackResourceSchema } from '../tools/core/resource-schemas';
import { type FlowBlockPoolRecord, FlowBlockPoolSchema } from '../flow/resource-schemas';
import { type PromptLabManifestRecord, PromptLabManifestSchema } from '../prompt-lab/manifest-schemas';
import { type LiteAdvisorResourceRecord, LiteAdvisorResourceSchema } from '../advisors/resource-schemas';

export interface ResourceDefinition<T> {
    id: string;
    relativePath: string;
    schema: ZodType<T>;
}

export interface ResourceSchemaMap {
    'flow-design.manifest': FlowDesignManifestRecord;
    'node-config-design.manifest': NodeConfigDesignManifestRecord;
    'llm.runtime.manifest': LlmRuntimeManifestRecord;
    'prompt-lab.manifest': PromptLabManifestRecord;
    'flow.block-pool': FlowBlockPoolRecord;
    'flow-design.advisors': LiteAdvisorResourceRecord;
    'tools.sample-tools.set': ToolPackResourceRecord;
    'tools.flow-design.set': ToolPackResourceRecord;
    'tools.node-config.set': ToolPackResourceRecord;
    'tools.task-graph.set': ToolPackResourceRecord;
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
    'prompt-lab.manifest': {
        id: 'prompt-lab.manifest',
        relativePath: 'products/prompt-lab/PROMPT_LAB_MANIFEST.yml',
        schema: PromptLabManifestSchema,
    },
    'flow.block-pool': {
        id: 'flow.block-pool',
        relativePath: 'flow/BLOCK_POOL.yml',
        schema: FlowBlockPoolSchema,
    },
    'flow-design.advisors': {
        id: 'flow-design.advisors',
        relativePath: 'skills/flow-designer/ADVISORS.yml',
        schema: LiteAdvisorResourceSchema,
    },
    'tools.sample-tools.set': {
        id: 'tools.sample-tools.set',
        relativePath: 'tools/sample-tools/TOOLS.yml',
        schema: ToolPackResourceSchema,
    },
    'tools.flow-design.set': {
        id: 'tools.flow-design.set',
        relativePath: 'skills/flow-designer/TOOLS.yml',
        schema: ToolPackResourceSchema,
    },
    'tools.node-config.set': {
        id: 'tools.node-config.set',
        relativePath: 'skills/node-config-designer/TOOLS.yml',
        schema: ToolPackResourceSchema,
    },
    'tools.task-graph.set': {
        id: 'tools.task-graph.set',
        relativePath: 'skills/flow-preflight-validator/TOOLS.yml',
        schema: ToolPackResourceSchema,
    },
};

export function getResourceDefinition<K extends ResourceId>(id: K): ResourceDefinition<ResourceSchemaMap[K]> {
    // TODO(resources): Extend resource definitions with manifest version / migration metadata
    // so older deployed manifests can be upgraded explicitly instead of failing schema validation.
    // Tool-set resources now carry an explicit payload version, but registry-level migration
    // policy is still the next step once cross-version compatibility rules are defined.
    return RESOURCE_DEFINITIONS[id];
}
