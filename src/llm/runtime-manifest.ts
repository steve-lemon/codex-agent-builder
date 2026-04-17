// Aggregated runtime LLM manifest that combines shared structured prompts and fake copy.
import { join } from 'node:path';
import { CachedJsonFileResource } from '../resources/json-file';
import { resolveJsonResourcePath } from '../resources/path-resolver';
import {
    LlmRuntimeManifestSchema,
    type FakeCopyRecord,
    type LlmRuntimeManifestRecord,
    type StructuredTaskPromptsRecord,
} from './runtime-manifest-schemas';

const runtimeManifestResource = new CachedJsonFileResource<LlmRuntimeManifestRecord>(
    resolveJsonResourcePath({
        fallbackRoot: join(process.cwd(), 'data'),
        relativePath: join('runtime', 'LLM_RUNTIME_MANIFEST.json'),
    }),
    LlmRuntimeManifestSchema,
);

/** Combined runtime manifest surface for LLM prompts and deterministic fake copy. */
export interface LlmRuntimeManifest {
    structuredTaskPrompts: StructuredTaskPromptsRecord;
    fakeCopy: FakeCopyRecord;
}

/** Loads the aggregated runtime manifest from the shared resource root. */
export async function getLlmRuntimeManifest(): Promise<LlmRuntimeManifest> {
    const manifest = await runtimeManifestResource.load();

    return {
        structuredTaskPrompts: manifest.structuredTaskPrompts,
        fakeCopy: manifest.fakeCopy,
    };
}
