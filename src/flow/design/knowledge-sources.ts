// Built-in knowledge-source implementations for flow-design.
import type { FlowDesignIntent, FlowDesignReflection } from './types';
import type { FlowDesignKnowledgeSource } from './knowledge';
import { getFlowDesignManifest, type FlowDesignManifest } from './manifest';

function unique(values: string[]): string[] {
    return [...new Set(values)];
}

/** Reads structured flow-design skill guidance from a manifest file on disk. */
export class ManifestFlowDesignKnowledgeSource implements FlowDesignKnowledgeSource {
    constructor(private readonly manifestLoader: () => Promise<FlowDesignManifest> = getFlowDesignManifest) {}

    async getDraftNotes(intent: FlowDesignIntent): Promise<string[]> {
        const { knowledge } = await this.manifestLoader();
        const conditionalNotes = (knowledge.conditionalDraftNotes ?? [])
            .filter(entry => {
                const match = entry.match ?? {};
                if (match.taskTypes && !match.taskTypes.includes(intent.taskType)) {
                    return false;
                }
                if (typeof match.wantsJson === 'boolean' && match.wantsJson !== intent.wantsJson) {
                    return false;
                }
                if (typeof match.wantsMultiple === 'boolean' && match.wantsMultiple !== intent.wantsMultiple) {
                    return false;
                }
                return true;
            })
            .flatMap(entry => entry.notes ?? []);

        return unique([...(knowledge.sharedDraftNotes ?? []), ...conditionalNotes]);
    }

    async getReflectionNotes(args: {
        intent: FlowDesignIntent;
        sampleResult: {
            status: 'completed' | 'failed' | 'cancelled';
            output?: unknown;
            logs: string[];
        };
        reflection: FlowDesignReflection;
    }): Promise<string[]> {
        const { knowledge } = await this.manifestLoader();
        const notes = [...(knowledge.reflectionNotes ?? [])];

        if (args.sampleResult.status !== 'completed') {
            notes.push('Stabilize the sample execution path before concluding that the design is acceptable.');
        }
        if (args.intent.wantsJson) {
            notes.push('Reflection should keep checking that structured outputs stay machine-readable.');
        }

        return unique(notes);
    }
}

/** Creates the default flow-design knowledge source backed by the skill manifest. */
export function createDefaultFlowDesignKnowledgeSource(): FlowDesignKnowledgeSource {
    return new ManifestFlowDesignKnowledgeSource();
}
