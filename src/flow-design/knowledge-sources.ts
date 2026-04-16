// Built-in knowledge-source implementations for flow-design.
import { join } from 'node:path';
import { z } from 'zod';
import { CachedJsonFileResource } from '../resources/json-file';
import { resolveJsonResourcePath } from '../resources/path-resolver';
import type { FlowDesignIntent, FlowDesignReflection } from './types';
import type { FlowDesignKnowledgeSource } from './knowledge';

const FlowDesignKnowledgeManifestSchema = z.object({
    sharedDraftNotes: z.array(z.string()).optional(),
    conditionalDraftNotes: z
        .array(
            z.object({
                match: z
                    .object({
                        taskTypes: z.array(z.string()).optional(),
                        wantsJson: z.boolean().optional(),
                        wantsMultiple: z.boolean().optional(),
                    })
                    .optional(),
                notes: z.array(z.string()).optional(),
            }),
        )
        .optional(),
    reflectionNotes: z.array(z.string()).optional(),
});

type FlowDesignKnowledgeManifest = z.infer<typeof FlowDesignKnowledgeManifestSchema>;

function unique(values: string[]): string[] {
    return [...new Set(values)];
}

/** Reads structured flow-design skill guidance from a manifest file on disk. */
export class ManifestFlowDesignKnowledgeSource implements FlowDesignKnowledgeSource {
    private readonly resource: CachedJsonFileResource<FlowDesignKnowledgeManifest>;

    constructor(
        manifestPath = resolveJsonResourcePath({
            fallbackRoot: join(process.cwd(), 'data'),
            relativePath: join('skills', 'flow-designer', 'FLOW_DESIGN_KNOWLEDGE.json'),
        }),
    ) {
        this.resource = new CachedJsonFileResource(manifestPath, FlowDesignKnowledgeManifestSchema);
    }

    async getDraftNotes(intent: FlowDesignIntent): Promise<string[]> {
        const manifest = await this.resource.load();
        const conditionalNotes = (manifest.conditionalDraftNotes ?? [])
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

        return unique([...(manifest.sharedDraftNotes ?? []), ...conditionalNotes]);
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
        const manifest = await this.resource.load();
        const notes = [...(manifest.reflectionNotes ?? [])];

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
