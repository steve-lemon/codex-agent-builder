// Manifest-backed defaults for flow-design prompts, sample inputs, and deterministic probe config.
import type { FlowDesignTaskType } from './types';
import { getFlowDesignManifest } from './manifest';

/** Returns the manifest-backed default sample input for a task type and request. */
export async function getFlowDesignSampleInputDefaults(
    taskType: FlowDesignTaskType,
    userRequest: string,
): Promise<string> {
    const { defaults } = await getFlowDesignManifest();
    const lowered = userRequest.toLowerCase();

    if (lowered.includes('keyword') || lowered.includes('키워드')) {
        return defaults.sampleInputs.keywordDriven;
    }

    return defaults.sampleInputs.byTaskType[taskType] ?? defaults.sampleInputs.default;
}

/** Returns the manifest-backed default system prompt for a task type. */
export async function getFlowDesignSystemPromptDefault(taskType: FlowDesignTaskType): Promise<string> {
    const { defaults } = await getFlowDesignManifest();
    return defaults.systemPrompts[taskType] ?? defaults.systemPrompts.unknown;
}

/** Returns the manifest-backed default AI model for deterministic flow-design drafts. */
export async function getFlowDesignDefaultModel(): Promise<string> {
    return (await getFlowDesignManifest()).defaults.aiNodeDefaults.model;
}

/** Returns the manifest-backed deterministic probe defaults for the built-in AI block. */
export async function getFlowDesignProbeDefaults() {
    const { defaults } = await getFlowDesignManifest();
    return defaults.probeDefaults;
}
