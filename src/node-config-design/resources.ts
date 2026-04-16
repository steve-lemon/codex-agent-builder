// File-backed defaults for node-config strategies.
import { join } from 'node:path';
import { z } from 'zod';
import { CachedJsonFileResource } from '../resources/json-file';
import { resolveJsonResourcePath } from '../resources/path-resolver';
import type { FlowDesignTaskType } from '../flow-design/types';

const NodeConfigDefaultsSchema = z.object({
    systemPrompts: z.record(z.string()),
    aiModelProfiles: z.object({
        default: z.string(),
        'blog-title-generation': z.string(),
        'structured-output': z.string(),
    }),
});

type NodeConfigDefaults = z.infer<typeof NodeConfigDefaultsSchema>;

const nodeConfigDefaultsResource = new CachedJsonFileResource<NodeConfigDefaults>(
    resolveJsonResourcePath({
        fallbackRoot: join(process.cwd(), 'data'),
        relativePath: join('skills', 'node-config-designer', 'NODE_CONFIG_DEFAULTS.json'),
    }),
    NodeConfigDefaultsSchema,
);

/** Returns the file-backed default system prompt for node-config strategies. */
export async function getNodeConfigSystemPromptDefault(taskType: FlowDesignTaskType): Promise<string> {
    const defaults = await nodeConfigDefaultsResource.load();
    return defaults.systemPrompts[taskType] ?? defaults.systemPrompts.unknown;
}

/** Returns the file-backed default AI model profile for node-config strategies. */
export async function getNodeConfigModelProfile(args: {
    taskType: FlowDesignTaskType;
    wantsJson: boolean;
    strategyNotes: string;
}): Promise<string> {
    const defaults = await nodeConfigDefaultsResource.load();
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
