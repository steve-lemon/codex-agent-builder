// File-backed defaults for flow-design prompts, sample inputs, and deterministic probe config.
import { join } from 'node:path';
import { z } from 'zod';
import { CachedJsonFileResource } from '../resources/json-file';
import { resolveJsonResourcePath } from '../resources/path-resolver';
import type { FlowDesignTaskType } from './types';

const FlowDesignDefaultsSchema = z.object({
    sampleInputs: z.object({
        default: z.string(),
        keywordDriven: z.string(),
        byTaskType: z.record(z.string()),
    }),
    systemPrompts: z.record(z.string()),
    aiNodeDefaults: z.object({
        model: z.string(),
    }),
    probeDefaults: z.object({
        sampleConfig: z.object({
            model: z.string(),
        }),
        sampleInputs: z.object({
            system: z.string(),
            prompt: z.string(),
        }),
    }),
});

type FlowDesignDefaults = z.infer<typeof FlowDesignDefaultsSchema>;

const flowDesignDefaultsResource = new CachedJsonFileResource<FlowDesignDefaults>(
    resolveJsonResourcePath({
        fallbackRoot: join(process.cwd(), 'data'),
        relativePath: join('skills', 'flow-designer', 'FLOW_DESIGN_DEFAULTS.json'),
    }),
    FlowDesignDefaultsSchema,
);

/** Returns the file-backed default sample input for a task type and request. */
export async function getFlowDesignSampleInputDefaults(
    taskType: FlowDesignTaskType,
    userRequest: string,
): Promise<string> {
    const defaults = await flowDesignDefaultsResource.load();
    const lowered = userRequest.toLowerCase();

    if (lowered.includes('keyword') || lowered.includes('키워드')) {
        return defaults.sampleInputs.keywordDriven;
    }

    return defaults.sampleInputs.byTaskType[taskType] ?? defaults.sampleInputs.default;
}

/** Returns the file-backed default system prompt for a task type. */
export async function getFlowDesignSystemPromptDefault(taskType: FlowDesignTaskType): Promise<string> {
    const defaults = await flowDesignDefaultsResource.load();
    return defaults.systemPrompts[taskType] ?? defaults.systemPrompts.unknown;
}

/** Returns the file-backed default AI model for deterministic flow-design drafts. */
export async function getFlowDesignDefaultModel(): Promise<string> {
    return (await flowDesignDefaultsResource.load()).aiNodeDefaults.model;
}

/** Returns the file-backed deterministic probe defaults for the built-in AI block. */
export async function getFlowDesignProbeDefaults() {
    const defaults = await flowDesignDefaultsResource.load();
    return defaults.probeDefaults;
}
