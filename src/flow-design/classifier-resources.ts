// File-backed prompts for flow-design lightweight classification.
import { join } from 'node:path';
import { z } from 'zod';
import { CachedJsonFileResource } from '../resources/json-file';
import { resolveJsonResourcePath } from '../resources/path-resolver';

const FlowDesignClassifierPromptsSchema = z.object({
    taskTypeSystemPrompt: z.string(),
    taskGraphSystemPrompt: z.string(),
});

type FlowDesignClassifierPrompts = z.infer<typeof FlowDesignClassifierPromptsSchema>;

const flowDesignClassifierPromptsResource = new CachedJsonFileResource<FlowDesignClassifierPrompts>(
    resolveJsonResourcePath({
        fallbackRoot: join(process.cwd(), 'data'),
        relativePath: join('skills', 'flow-designer', 'FLOW_DESIGN_CLASSIFIER_PROMPTS.json'),
    }),
    FlowDesignClassifierPromptsSchema,
);

/** Returns the system prompt used for flow-design task-type classification. */
export async function getFlowDesignTaskTypeClassifierPrompt(): Promise<string> {
    return (await flowDesignClassifierPromptsResource.load()).taskTypeSystemPrompt;
}

/** Returns the system prompt used for flow-design task-graph classification. */
export async function getFlowDesignTaskGraphClassifierPrompt(): Promise<string> {
    return (await flowDesignClassifierPromptsResource.load()).taskGraphSystemPrompt;
}
