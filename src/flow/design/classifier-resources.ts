// File-backed prompts for flow-design lightweight classification.
import { getFlowDesignManifest } from './manifest';

/** Returns the system prompt used for flow-design task-type classification. */
export async function getFlowDesignTaskTypeClassifierPrompt(): Promise<string> {
    return (await getFlowDesignManifest()).classifierPrompts.taskTypeSystemPrompt;
}

/** Returns the system prompt used for flow-design task-graph classification. */
export async function getFlowDesignTaskGraphClassifierPrompt(): Promise<string> {
    return (await getFlowDesignManifest()).classifierPrompts.taskGraphSystemPrompt;
}
