// Aggregated flow-design manifest that combines catalogs, prompts, defaults, and knowledge.
import { loadResource } from '../resources/loader';
import type {
    FlowDesignClassifierPromptsRecord,
    FlowDesignDefaultsRecord,
    FlowDesignManifestRecord,
    FlowDesignKnowledgeManifestRecord,
    FlowDesignReflectionRuleRecord,
    FlowDesignTaskGraphTemplateRecord,
    FlowDesignTaskTypeDefinitionRecord,
} from './manifest-schemas';

export interface FlowDesignManifest {
    taskTypes: FlowDesignTaskTypeDefinitionRecord[];
    taskGraphTemplates: FlowDesignTaskGraphTemplateRecord[];
    classifierPrompts: FlowDesignClassifierPromptsRecord;
    defaults: FlowDesignDefaultsRecord;
    knowledge: FlowDesignKnowledgeManifestRecord & {
        reflectionRules: FlowDesignReflectionRuleRecord[];
    };
}

export async function getFlowDesignManifest(): Promise<FlowDesignManifest> {
    // TODO(flow-design): If this manifest grows further, split the typed view from the raw
    // resource payload so consumers can request only the sections they need.
    const manifest: FlowDesignManifestRecord = await loadResource('flow-design.manifest');

    return {
        taskTypes: manifest.taskTypes,
        taskGraphTemplates: manifest.taskGraphTemplates,
        classifierPrompts: manifest.classifierPrompts,
        defaults: manifest.defaults,
        knowledge: {
            ...manifest.knowledge,
            reflectionRules: manifest.knowledge.reflectionRules ?? [],
        },
    };
}
