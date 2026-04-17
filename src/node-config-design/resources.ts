// Manifest-backed defaults for node-config strategies.
import type { FlowDesignTaskType } from '../flow-design/types';
import { getNodeConfigDesignManifest } from './manifest';

/** Returns the manifest-backed default system prompt for node-config strategies. */
export async function getNodeConfigSystemPromptDefault(taskType: FlowDesignTaskType): Promise<string> {
    const { defaults } = await getNodeConfigDesignManifest();
    return defaults.systemPrompts[taskType] ?? defaults.systemPrompts.unknown;
}

/** Returns the manifest-backed default AI model profile for node-config strategies. */
export async function getNodeConfigModelProfile(args: {
    taskType: FlowDesignTaskType;
    wantsJson: boolean;
    strategyNotes: string;
}): Promise<string> {
    const { defaults } = await getNodeConfigDesignManifest();
    if (args.strategyNotes.includes('json') || args.wantsJson) {
        return defaults.aiModelProfiles['structured-output'];
    }
    if (args.strategyNotes.includes('title') || args.strategyNotes.includes('headline')) {
        return defaults.aiModelProfiles['blog-title-generation'];
    }
    if (args.taskType === 'blog-title-generation') {
        return defaults.aiModelProfiles['blog-title-generation'];
    }
    return defaults.aiModelProfiles.default;
}
