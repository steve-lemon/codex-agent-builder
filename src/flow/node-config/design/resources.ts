// Manifest-backed defaults for node-config strategies.
import { logDebug } from '../../../diagnostics/logger';
import type { FlowDesignTaskType } from '../../design/types';
import { getNodeConfigDesignManifest } from './manifest';

/** Returns the manifest-backed default system prompt for node-config strategies. */
export async function getNodeConfigSystemPromptDefault(taskType: FlowDesignTaskType): Promise<string> {
    const { defaults } = await getNodeConfigDesignManifest();
    const prompt = defaults.systemPrompts[taskType] ?? defaults.systemPrompts.unknown;
    logDebug({
        scope: 'node-config',
        action: 'system_prompt_selected',
        message: 'Selected node-config system prompt.',
        data: {
            taskType,
            usedFallback: !(taskType in defaults.systemPrompts),
        },
    });
    return prompt;
}

/** Returns the manifest-backed default AI model profile for node-config strategies. */
export async function getNodeConfigModelProfile(args: {
    taskType: FlowDesignTaskType;
    wantsJson: boolean;
    strategyNotes: string;
}): Promise<string> {
    const { defaults } = await getNodeConfigDesignManifest();
    if (args.strategyNotes.includes('json') || args.wantsJson) {
        const profileId = defaults.modelSelection.jsonPreferredProfileId;
        if (profileId && defaults.aiModelProfiles[profileId]) {
            logDebug({
                scope: 'node-config',
                action: 'model_profile_selected',
                message: 'Selected model profile for JSON-oriented output.',
                data: {
                    taskType: args.taskType,
                    profileId,
                    reason: 'json-preferred',
                },
            });
            return defaults.aiModelProfiles[profileId];
        }
    }

    for (const rule of defaults.modelSelection.strategyNoteProfileRules) {
        if (rule.keywords.some(keyword => args.strategyNotes.includes(keyword.toLowerCase()))) {
            const profile = defaults.aiModelProfiles[rule.profileId];
            if (profile) {
                logDebug({
                    scope: 'node-config',
                    action: 'model_profile_selected',
                    message: 'Selected model profile from strategy note rule.',
                    data: {
                        taskType: args.taskType,
                        profileId: rule.profileId,
                        reason: 'strategy-note-rule',
                    },
                });
                return profile;
            }
        }
    }

    const taskTypeProfileId = defaults.modelSelection.taskTypeProfileIds[args.taskType];
    if (taskTypeProfileId && defaults.aiModelProfiles[taskTypeProfileId]) {
        logDebug({
            scope: 'node-config',
            action: 'model_profile_selected',
            message: 'Selected model profile for task type.',
            data: {
                taskType: args.taskType,
                profileId: taskTypeProfileId,
                reason: 'task-type',
            },
        });
        return defaults.aiModelProfiles[taskTypeProfileId];
    }

    logDebug({
        scope: 'node-config',
        action: 'model_profile_selected',
        message: 'Selected default model profile.',
        data: {
            taskType: args.taskType,
            profileId: defaults.modelSelection.defaultProfileId,
            reason: 'default',
        },
    });
    return defaults.aiModelProfiles[defaults.modelSelection.defaultProfileId];
}
