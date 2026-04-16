// Built-in knowledge-source implementations for flow-design.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FlowDesignIntent, FlowDesignReflection } from './types';
import type { FlowDesignKnowledgeSource } from './knowledge';

interface FlowDesignKnowledgeManifest {
    sharedDraftNotes?: string[];
    conditionalDraftNotes?: Array<{
        match?: {
            taskTypes?: string[];
            wantsJson?: boolean;
            wantsMultiple?: boolean;
        };
        notes?: string[];
    }>;
    reflectionNotes?: string[];
}

function unique(values: string[]): string[] {
    return [...new Set(values)];
}

/** Reads structured flow-design skill guidance from a manifest file on disk. */
export class ManifestFlowDesignKnowledgeSource implements FlowDesignKnowledgeSource {
    private manifest?: FlowDesignKnowledgeManifest;

    constructor(
        private readonly manifestPath = join(
            process.cwd(),
            'data',
            'skills',
            'flow-designer',
            'FLOW_DESIGN_KNOWLEDGE.json',
        ),
    ) {}

    private async loadManifest(): Promise<FlowDesignKnowledgeManifest> {
        if (this.manifest) {
            return this.manifest;
        }

        const raw = await readFile(this.manifestPath, 'utf-8');
        this.manifest = JSON.parse(raw) as FlowDesignKnowledgeManifest;
        return this.manifest;
    }

    async getDraftNotes(intent: FlowDesignIntent): Promise<string[]> {
        const manifest = await this.loadManifest();
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
        const manifest = await this.loadManifest();
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
