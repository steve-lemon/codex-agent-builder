import { loadResource } from '../resources/loader';
import type { ResourceId } from '../resources/registry';
import type { LiteAdvisorDefinitionRecord } from './resource-schemas';

type LiteAdvisorResourceId = Extract<ResourceId, 'flow-design.advisors'>;

export async function getLiteAdvisorDefinitions(resourceId: LiteAdvisorResourceId): Promise<LiteAdvisorDefinitionRecord[]> {
    return (await loadResource(resourceId)).advisors;
}

export async function getLiteAdvisorDefinition(
    resourceId: LiteAdvisorResourceId,
    advisorId: string,
): Promise<LiteAdvisorDefinitionRecord> {
    // TODO(advisors): Generalize resource lookup once more domains expose advisor packs,
    // so callers can resolve advisor ids without knowing the pack resource id up front.
    const definitions = await getLiteAdvisorDefinitions(resourceId);
    const definition = definitions.find(advisor => advisor.id === advisorId);
    if (!definition) {
        throw new Error(`Lite advisor resource not found: ${resourceId}:${advisorId}`);
    }
    return definition;
}
