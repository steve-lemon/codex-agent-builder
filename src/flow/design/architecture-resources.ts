import { loadResource } from '../../resources/loader';
import type { ArchitectureKnowledgeResourceRecord } from './architecture-schemas';

export async function loadArchitectureKnowledgeResource(): Promise<ArchitectureKnowledgeResourceRecord> {
    return await loadResource('flow-design.architecture-knowledge');
}
