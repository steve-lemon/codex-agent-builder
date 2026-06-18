// Aggregated node-config design manifest that combines defaults and skill guidance.
import { loadResource } from '../../../resources/loader';
import type {
    NodeConfigDefaultsRecord,
    NodeConfigDesignManifestRecord,
    NodeConfigKnowledgeManifestRecord,
} from './manifest-schemas';

export interface NodeConfigDesignManifest {
    defaults: NodeConfigDefaultsRecord;
    knowledge: NodeConfigKnowledgeManifestRecord;
}

export async function getNodeConfigDesignManifest(): Promise<NodeConfigDesignManifest> {
    // TODO(node-config): Allow block-family strategy metadata to be pulled into the manifest
    // view when strategy registration moves from code-only wiring to resource-backed configuration.
    const manifest: NodeConfigDesignManifestRecord = await loadResource('node-config-design.manifest');

    return {
        defaults: manifest.defaults,
        knowledge: manifest.knowledge,
    };
}
