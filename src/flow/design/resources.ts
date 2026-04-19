// Manifest-backed defaults for flow-design prompts, sample inputs, and deterministic probe config.
import { resolveRuntimeModelAlias } from '../../llm/runtime-model-alias';
import type { FlowDesignTaskType } from './types';
import { getFlowDesignManifest } from './manifest';

export interface FlowDesignSampleInputDefaults {
    sampleInput: string;
    source: 'default' | 'synthetic-graph-json';
    readyForDesign: boolean;
}

function buildSyntheticGraphJsonSample(): string {
    return JSON.stringify(
        {
            nodes: [
                {
                    id: 'input-node',
                    blockId: 'json-input',
                    label: 'Graph Input',
                    config: {
                        label: 'Flow Graph JSON',
                    },
                },
                {
                    id: 'ai-node',
                    blockId: 'ai-generate',
                    label: 'Explain Graph',
                    config: {
                        jsonOutput: 'false',
                    },
                },
                {
                    id: 'view-node',
                    blockId: 'view',
                    label: 'Review Explanation',
                    config: {},
                },
            ],
            edges: [
                {
                    sourceNodeId: 'input-node',
                    targetNodeId: 'ai-node',
                    label: 'graph json',
                },
                {
                    sourceNodeId: 'ai-node',
                    targetNodeId: 'view-node',
                    label: 'markdown explanation',
                },
            ],
        },
        null,
        2,
    );
}

/** Returns the manifest-backed default sample input for a task type and request. */
export async function getFlowDesignSampleInputDefaults(
    taskType: FlowDesignTaskType,
    userRequest: string,
): Promise<FlowDesignSampleInputDefaults> {
    const { defaults } = await getFlowDesignManifest();
    const lowered = userRequest.toLowerCase();

    if (
        (lowered.includes('graph') || lowered.includes('그래프')) &&
        lowered.includes('json') &&
        (lowered.includes('explain') ||
            lowered.includes('설명') ||
            lowered.includes('markdown') ||
            lowered.includes('(md)') ||
            lowered.includes('md'))
    ) {
        return {
            sampleInput: buildSyntheticGraphJsonSample(),
            source: 'synthetic-graph-json',
            readyForDesign: true,
        };
    }

    if (taskType === 'blog-title-generation' && (lowered.includes('keyword') || lowered.includes('키워드'))) {
        return {
            sampleInput: defaults.sampleInputs.keywordDriven,
            source: 'default',
            readyForDesign: true,
        };
    }

    return {
        sampleInput: defaults.sampleInputs.byTaskType[taskType] ?? defaults.sampleInputs.default,
        source: 'default',
        readyForDesign: true,
    };
}

/** Returns the manifest-backed default system prompt for a task type. */
export async function getFlowDesignSystemPromptDefault(taskType: FlowDesignTaskType): Promise<string> {
    const { defaults } = await getFlowDesignManifest();
    return defaults.systemPrompts[taskType] ?? defaults.systemPrompts.unknown;
}

/** Returns the manifest-backed default AI model for deterministic flow-design drafts. */
export async function getFlowDesignDefaultModel(): Promise<string> {
    return resolveRuntimeModelAlias((await getFlowDesignManifest()).defaults.aiNodeDefaults.model);
}

/** Returns the manifest-backed deterministic probe defaults for the built-in AI block. */
export async function getFlowDesignProbeDefaults() {
    const { defaults } = await getFlowDesignManifest();
    return {
        ...defaults.probeDefaults,
        sampleConfig: {
            ...defaults.probeDefaults.sampleConfig,
            model: resolveRuntimeModelAlias(defaults.probeDefaults.sampleConfig.model),
        },
    };
}
