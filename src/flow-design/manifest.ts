// Aggregated flow-design manifest that pulls together catalogs and classifier prompts.
import { join } from 'node:path';
import { CachedJsonFileResource } from '../resources/json-file';
import { resolveJsonResourcePath } from '../resources/path-resolver';
import {
    FlowDesignClassifierPromptsSchema,
    FlowDesignDefaultsSchema,
    FlowDesignKnowledgeManifestSchema,
    FlowDesignTaskTypeCatalogSchema,
    TaskGraphCatalogSchema,
    type FlowDesignClassifierPromptsRecord,
    type FlowDesignDefaultsRecord,
    type FlowDesignKnowledgeManifestRecord,
    type FlowDesignTaskGraphTemplateRecord,
    type FlowDesignTaskTypeDefinitionRecord,
} from './manifest-schemas';

const taskTypeCatalogResource = new CachedJsonFileResource(
    resolveJsonResourcePath({
        fallbackRoot: join(process.cwd(), 'data'),
        relativePath: join('skills', 'flow-designer', 'FLOW_DESIGN_MANIFEST.json'),
    }),
    FlowDesignTaskTypeCatalogSchema.extend({
        taskGraphTemplates: TaskGraphCatalogSchema.shape.templates,
        classifierPrompts: FlowDesignClassifierPromptsSchema,
        defaults: FlowDesignDefaultsSchema,
        knowledge: FlowDesignKnowledgeManifestSchema,
    }),
);

/** Combined metadata surface for flow-design task classification, graph templates, and classifier prompts. */
export interface FlowDesignManifest {
    taskTypes: FlowDesignTaskTypeDefinitionRecord[];
    taskGraphTemplates: FlowDesignTaskGraphTemplateRecord[];
    classifierPrompts: FlowDesignClassifierPromptsRecord;
    defaults: FlowDesignDefaultsRecord;
    knowledge: FlowDesignKnowledgeManifestRecord;
}

/** Loads the aggregated flow-design manifest from the shared resource root. */
export async function getFlowDesignManifest(): Promise<FlowDesignManifest> {
    const manifest = await taskTypeCatalogResource.load();

    return {
        taskTypes: manifest.taskTypes,
        taskGraphTemplates: manifest.taskGraphTemplates,
        classifierPrompts: manifest.classifierPrompts,
        defaults: manifest.defaults,
        knowledge: manifest.knowledge,
    };
}
