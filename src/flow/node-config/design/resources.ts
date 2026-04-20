// Manifest-backed defaults for node-config strategies.
import { logDebug } from '../../../diagnostics/logger';
import { resolveRuntimeModelAlias } from '../../../llm/runtime-model-alias';
import type { FlowDesignTaskType } from '../../design/types';
import type { DesignBrief } from '../../design/types';
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
            return resolveRuntimeModelAlias(defaults.aiModelProfiles[profileId]);
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
                return resolveRuntimeModelAlias(profile);
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
        return resolveRuntimeModelAlias(defaults.aiModelProfiles[taskTypeProfileId]);
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
    return resolveRuntimeModelAlias(defaults.aiModelProfiles[defaults.modelSelection.defaultProfileId]);
}

/** Returns the manifest-backed default output schema for JSON-oriented AI node configuration. */
export async function getNodeConfigOutputSchemaDefault(args: {
    taskType: FlowDesignTaskType;
    wantsJson: boolean;
    userRequest: string;
    desiredCount: number;
    brief?: DesignBrief;
}): Promise<string> {
    if (!args.wantsJson) {
        return '';
    }

    const { defaults } = await getNodeConfigDesignManifest();
    const lowered = args.userRequest.toLowerCase();
    const operationModel = args.brief?.mission.operationModel ?? [];

    if (operationModel.includes('edit') || args.taskType === 'text-editing') {
        logDebug({
            scope: 'node-config',
            action: 'output_schema_selected',
            message: 'Selected corrected-text schema.',
            data: {
                taskType: args.taskType,
                reason: 'text-editing',
            },
        });
        return defaults.outputSchemaTemplates.correctedText;
    }

    if (operationModel.includes('summarize') || args.taskType === 'text-summarization') {
        logDebug({
            scope: 'node-config',
            action: 'output_schema_selected',
            message: 'Selected summary-lines schema.',
            data: {
                taskType: args.taskType,
                reason: 'text-summarization',
            },
        });
        return defaults.outputSchemaTemplates.summaryLines;
    }

    if (operationModel.includes('diagnose') || args.taskType === 'text-analysis') {
        logDebug({
            scope: 'node-config',
            action: 'output_schema_selected',
            message: 'Selected analysis-report schema.',
            data: {
                taskType: args.taskType,
                reason: 'text-analysis',
            },
        });
        return defaults.outputSchemaTemplates.analysisReport;
    }

    if (operationModel.includes('extract') || args.taskType === 'keyword-analysis') {
        logDebug({
            scope: 'node-config',
            action: 'output_schema_selected',
            message: 'Selected keyword-list schema.',
            data: {
                taskType: args.taskType,
                reason: 'keyword-analysis',
            },
        });
        return defaults.outputSchemaTemplates.keywordList;
    }

    if (
        (lowered.includes('자음') || lowered.includes('consonant')) &&
        (lowered.includes('모음') || lowered.includes('vowel')) &&
        (lowered.includes('개수') || lowered.includes('count'))
    ) {
        logDebug({
            scope: 'node-config',
            action: 'output_schema_selected',
            message: 'Selected consonant/vowel count schema.',
            data: {
                taskType: args.taskType,
                reason: 'consonant-vowel-count',
            },
        });
        return defaults.outputSchemaTemplates.consonantVowelCounts;
    }

    if (operationModel.includes('count') || args.taskType === 'text-counting') {
        logDebug({
            scope: 'node-config',
            action: 'output_schema_selected',
            message: 'Selected generic count-map schema.',
            data: {
                taskType: args.taskType,
                reason: 'generic-count',
            },
        });
        return defaults.outputSchemaTemplates.genericCountMap;
    }

    if (args.taskType === 'blog-title-generation' || args.desiredCount > 1) {
        logDebug({
            scope: 'node-config',
            action: 'output_schema_selected',
            message: 'Selected string list schema.',
            data: {
                taskType: args.taskType,
                reason: 'multi-item',
            },
        });
        return defaults.outputSchemaTemplates.stringList;
    }

    logDebug({
        scope: 'node-config',
        action: 'output_schema_selected',
        message: 'Selected default structured object schema.',
        data: {
            taskType: args.taskType,
            reason: 'default',
        },
    });
    return defaults.outputSchemaTemplates.defaultStructuredObject;
}
