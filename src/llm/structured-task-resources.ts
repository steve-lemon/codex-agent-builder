// Manifest-backed prompts for common structured LLM tasks such as plan/reflect/finalize.
import { getLlmRuntimeManifest } from './runtime-manifest';

/** Returns the shared planner system prompt used for structured plan generation. */
export async function getPlanSystemPrompt(): Promise<string> {
    return (await getLlmRuntimeManifest()).structuredTaskPrompts.planSystemPrompt;
}

/** Returns the shared reflector system prompt used for structured reflection. */
export async function getReflectSystemPrompt(): Promise<string> {
    return (await getLlmRuntimeManifest()).structuredTaskPrompts.reflectSystemPrompt;
}

/** Returns the shared finalizer system prompt used for structured final results. */
export async function getFinalizeSystemPrompt(): Promise<string> {
    return (await getLlmRuntimeManifest()).structuredTaskPrompts.finalizeSystemPrompt;
}
