// Aggregated runtime LLM manifest that combines shared structured prompts and fake copy.
import { loadResource } from '../resources/loader';
import type {
    DefaultToolPackIdsRecord,
    FakeCopyRecord,
    LlmRuntimeManifestRecord,
    StructuredTaskPromptsRecord,
} from './runtime-manifest-schemas';

export interface LlmRuntimeManifest {
    defaultToolPackIds: DefaultToolPackIdsRecord;
    structuredTaskPrompts: StructuredTaskPromptsRecord;
    fakeCopy: FakeCopyRecord;
}

export async function getLlmRuntimeManifest(): Promise<LlmRuntimeManifest> {
    // TODO(llm-runtime): Split fake copy from prompt resources if real deployments want
    // different lifecycle rules for test fixtures versus operator-tuned prompts.
    // TODO(llm-runtime): Add validation for duplicate or unknown defaultToolPackIds
    // once tool-pack registration is fully declarative.
    const manifest: LlmRuntimeManifestRecord = await loadResource('llm.runtime.manifest');

    return {
        defaultToolPackIds: manifest.defaultToolPackIds,
        structuredTaskPrompts: manifest.structuredTaskPrompts,
        fakeCopy: manifest.fakeCopy,
    };
}
