// Adapters that let lightweight classifiers back the flow-design advisor interfaces.
import type { FlowDesignTaskGraphTemplate } from './task-graphs';
import type { FlowDesignTaskTypeDefinition } from './task-types';
import type { FlowDesignTaskGraphModel } from './task-graphs';
import type { FlowDesignTaskTypeModel } from './task-types';

/** Shared classifier boundary for lightweight task-type/task-graph recommendation models. */
export interface FlowDesignLightweightClassifier {
    classifyTaskType?(args: {
        userRequest: string;
        wantsJson: boolean;
        taskTypes: FlowDesignTaskTypeDefinition[];
    }): Promise<{
        taskType: string;
        confidence?: number;
        rationale?: string;
    }>;
    classifyTaskGraph?(args: { userRequest: string; templates: FlowDesignTaskGraphTemplate[] }): Promise<{
        templateId: string;
        confidence?: number;
        rationale?: string;
    }>;
}

/** Builds a task-type model adapter from a shared lightweight classifier. */
export function createTaskTypeModelFromClassifier(
    classifier: FlowDesignLightweightClassifier,
): FlowDesignTaskTypeModel {
    return {
        async classify(args) {
            if (!classifier.classifyTaskType) {
                return {
                    taskType: '',
                    rationale: 'No task-type classifier implementation was provided.',
                };
            }

            return classifier.classifyTaskType(args);
        },
    };
}

/** Builds a task-graph model adapter from a shared lightweight classifier. */
export function createTaskGraphModelFromClassifier(
    classifier: FlowDesignLightweightClassifier,
): FlowDesignTaskGraphModel {
    return {
        async classify(args) {
            if (!classifier.classifyTaskGraph) {
                return {
                    templateId: '',
                    rationale: 'No task-graph classifier implementation was provided.',
                };
            }

            return classifier.classifyTaskGraph(args);
        },
    };
}
