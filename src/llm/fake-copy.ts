// Manifest-backed deterministic copy used by fake LLM planners and formatters.
import { getLlmRuntimeManifest } from './runtime-manifest';

/** Returns deterministic fake planner copy from the shared async-backed resource layer. */
export async function getFakePlanCopy() {
    return (await getLlmRuntimeManifest()).fakeCopy.plan;
}

/** Returns deterministic fake finalizer copy from the shared async-backed resource layer. */
export async function getFakeFinalCopy() {
    return (await getLlmRuntimeManifest()).fakeCopy.final;
}
