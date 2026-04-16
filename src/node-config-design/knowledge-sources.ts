// Built-in knowledge-source implementations for node-config design.
import { join } from 'node:path';
import { z } from 'zod';
import type { FlowBlockDefinition } from '../flow/types';
import { CachedJsonFileResource } from '../resources/json-file';
import { resolveJsonResourcePath } from '../resources/path-resolver';
import type { NodeConfigurationDesignInput, NodeConfigurationStrategyDirective } from './types';
import type { NodeConfigKnowledgeSource } from './knowledge';

function unique(values: string[]): string[] {
    return [...new Set(values)];
}

/** Reads guidance embedded directly in participating block definitions. */
export class BlockMetadataNodeConfigKnowledgeSource implements NodeConfigKnowledgeSource {
    getSharedNotes(input: NodeConfigurationDesignInput): string[] {
        return unique(
            input.flow.nodes.flatMap(node => {
                const block = input.flow.blocks.find(candidate => candidate.id === node.blockId);
                return block?.nodeConfigGuidance?.sharedNotes ?? [];
            }),
        );
    }

    getStrategyDirectives(input: NodeConfigurationDesignInput): NodeConfigurationStrategyDirective[] {
        const directives = input.flow.nodes.flatMap(node => {
            const block = input.flow.blocks.find(candidate => candidate.id === node.blockId);
            return (block?.nodeConfigGuidance?.strategyDirectives ?? []).filter(directive => {
                if (directive.strategyId !== 'ai-generation') {
                    return true;
                }
                if (directive.note.toLowerCase().includes('structured-output')) {
                    return input.wantsJson;
                }
                return true;
            });
        });

        const seen = new Set<string>();
        return directives.filter(directive => {
            const key = `${directive.strategyId}:${directive.note}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }
}

function collectBlockIds(flowBlocks: FlowBlockDefinition[]): Set<string> {
    return new Set(flowBlocks.map(block => block.id));
}

const SkillKnowledgeManifestSchema = z.object({
    sharedNotes: z.array(z.string()).optional(),
    conditionalSharedNotes: z
        .array(
            z.object({
                blockIds: z.array(z.string()).optional(),
                notes: z.array(z.string()).optional(),
            }),
        )
        .optional(),
    strategyDirectives: z
        .array(
            z.object({
                blockIds: z.array(z.string()).optional(),
                strategyId: z.string(),
                note: z.string(),
            }),
        )
        .optional(),
});

type SkillKnowledgeManifest = z.infer<typeof SkillKnowledgeManifestSchema>;

/** Reads structured node-config skill guidance from a manifest file on disk. */
export class ManifestSkillDocumentNodeConfigKnowledgeSource implements NodeConfigKnowledgeSource {
    private readonly resource: CachedJsonFileResource<SkillKnowledgeManifest>;

    constructor(
        manifestPath = resolveJsonResourcePath({
            fallbackRoot: join(process.cwd(), 'data'),
            relativePath: join('skills', 'node-config-designer', 'NODE_CONFIG_KNOWLEDGE.json'),
        }),
    ) {
        this.resource = new CachedJsonFileResource(manifestPath, SkillKnowledgeManifestSchema);
    }

    async getSharedNotes(input: NodeConfigurationDesignInput): Promise<string[]> {
        const blockIds = collectBlockIds(input.flow.blocks);
        const manifest = await this.resource.load();
        const conditionalNotes = (manifest.conditionalSharedNotes ?? [])
            .filter(entry => (entry.blockIds ?? []).some(blockId => blockIds.has(blockId)))
            .flatMap(entry => entry.notes ?? []);

        return unique([...(manifest.sharedNotes ?? []), ...conditionalNotes]);
    }

    async getStrategyDirectives(input: NodeConfigurationDesignInput): Promise<NodeConfigurationStrategyDirective[]> {
        const blockIds = collectBlockIds(input.flow.blocks);
        const manifest = await this.resource.load();
        return (manifest.strategyDirectives ?? [])
            .filter(entry => (entry.blockIds ?? []).some(blockId => blockIds.has(blockId)))
            .map(entry => ({
                strategyId: entry.strategyId,
                note: entry.note,
            }));
    }
}

/** Composes multiple knowledge sources into one merged source. */
export class CompositeNodeConfigKnowledgeSource implements NodeConfigKnowledgeSource {
    constructor(private readonly sources: NodeConfigKnowledgeSource[]) {}

    async getSharedNotes(input: NodeConfigurationDesignInput): Promise<string[]> {
        const allNotes = await Promise.all(this.sources.map(source => Promise.resolve(source.getSharedNotes(input))));
        return unique(allNotes.flat());
    }

    async getStrategyDirectives(input: NodeConfigurationDesignInput): Promise<NodeConfigurationStrategyDirective[]> {
        const allDirectives = await Promise.all(
            this.sources.map(source => Promise.resolve(source.getStrategyDirectives(input))),
        );
        return allDirectives.flat();
    }
}

/** Creates the default knowledge source that combines block metadata and skill guidance. */
export function createDefaultNodeConfigKnowledgeSource(): NodeConfigKnowledgeSource {
    return new CompositeNodeConfigKnowledgeSource([
        new BlockMetadataNodeConfigKnowledgeSource(),
        new ManifestSkillDocumentNodeConfigKnowledgeSource(),
    ]);
}
