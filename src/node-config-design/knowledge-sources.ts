// Built-in knowledge-source implementations for node-config design.
import type { FlowBlockDefinition } from '../flow/types';
import type { NodeConfigurationDesignInput, NodeConfigurationStrategyDirective } from './types';
import type { NodeConfigKnowledgeSource } from './knowledge';
import { getNodeConfigDesignManifest } from './manifest';

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

/** Reads structured node-config skill guidance from a manifest file on disk. */
export class ManifestSkillDocumentNodeConfigKnowledgeSource implements NodeConfigKnowledgeSource {
    constructor(
        private readonly manifestLoader: () => Promise<ReturnType<typeof getNodeConfigDesignManifest> extends Promise<infer T> ? T : never> = getNodeConfigDesignManifest,
    ) {}

    async getSharedNotes(input: NodeConfigurationDesignInput): Promise<string[]> {
        const blockIds = collectBlockIds(input.flow.blocks);
        const { knowledge } = await this.manifestLoader();
        const conditionalNotes = (knowledge.conditionalSharedNotes ?? [])
            .filter(entry => (entry.blockIds ?? []).some(blockId => blockIds.has(blockId)))
            .flatMap(entry => entry.notes ?? []);

        return unique([...(knowledge.sharedNotes ?? []), ...conditionalNotes]);
    }

    async getStrategyDirectives(input: NodeConfigurationDesignInput): Promise<NodeConfigurationStrategyDirective[]> {
        const blockIds = collectBlockIds(input.flow.blocks);
        const { knowledge } = await this.manifestLoader();
        return (knowledge.strategyDirectives ?? [])
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
