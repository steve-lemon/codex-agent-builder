// Aggregated node-config design manifest that combines defaults and skill guidance.
import { join } from 'node:path';
import { CachedJsonFileResource } from '../resources/json-file';
import { resolveJsonResourcePath } from '../resources/path-resolver';
import {
    NodeConfigDesignManifestSchema,
    NodeConfigKnowledgeManifestSchema,
    type NodeConfigDefaultsRecord,
    type NodeConfigDesignManifestRecord,
    type NodeConfigKnowledgeManifestRecord,
} from './manifest-schemas';

const nodeConfigManifestResource = new CachedJsonFileResource<NodeConfigDesignManifestRecord>(
    resolveJsonResourcePath({
        fallbackRoot: join(process.cwd(), 'data'),
        relativePath: join('skills', 'node-config-designer', 'NODE_CONFIG_MANIFEST.json'),
    }),
    NodeConfigDesignManifestSchema,
);

/** Combined metadata surface for node-config defaults and skill guidance. */
export interface NodeConfigDesignManifest {
    defaults: NodeConfigDefaultsRecord;
    knowledge: NodeConfigKnowledgeManifestRecord;
}

/** Loads the aggregated node-config manifest from the shared resource root. */
export async function getNodeConfigDesignManifest(): Promise<NodeConfigDesignManifest> {
    const manifest = await nodeConfigManifestResource.load();

    return {
        defaults: manifest.defaults,
        knowledge: manifest.knowledge,
    };
}
