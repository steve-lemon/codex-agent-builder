// Built-in knowledge-source implementations for node-config design.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FlowBlockDefinition } from '../flow/types';
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

interface SkillKnowledgeManifest {
    sharedNotes?: string[];
    conditionalSharedNotes?: Array<{
        blockIds?: string[];
        notes?: string[];
    }>;
    strategyDirectives?: Array<{
        blockIds?: string[];
        strategyId: string;
        note: string;
    }>;
}

/** Reads structured node-config skill guidance from a manifest file on disk. */
export class ManifestSkillDocumentNodeConfigKnowledgeSource implements NodeConfigKnowledgeSource {
    private manifest?: SkillKnowledgeManifest;

    constructor(
        private readonly manifestPath = join(
            process.cwd(),
            'data',
            'skills',
            'node-config-designer',
            'NODE_CONFIG_KNOWLEDGE.json',
        ),
    ) {}

    private async loadManifest(): Promise<SkillKnowledgeManifest> {
        if (this.manifest) {
            return this.manifest;
        }

        const raw = await readFile(this.manifestPath, 'utf-8');
        this.manifest = JSON.parse(raw) as SkillKnowledgeManifest;
        return this.manifest;
    }

    async getSharedNotes(input: NodeConfigurationDesignInput): Promise<string[]> {
        const blockIds = collectBlockIds(input.flow.blocks);
        const manifest = await this.loadManifest();
        const conditionalNotes = (manifest.conditionalSharedNotes ?? [])
            .filter(entry => (entry.blockIds ?? []).some(blockId => blockIds.has(blockId)))
            .flatMap(entry => entry.notes ?? []);

        return unique([...(manifest.sharedNotes ?? []), ...conditionalNotes]);
    }

    async getStrategyDirectives(input: NodeConfigurationDesignInput): Promise<NodeConfigurationStrategyDirective[]> {
        const blockIds = collectBlockIds(input.flow.blocks);
        const manifest = await this.loadManifest();
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
