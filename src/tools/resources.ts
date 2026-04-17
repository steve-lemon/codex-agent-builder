import { AgentError } from '../errors/agent-error';
import { loadResource } from '../resources/loader';
import type { ResourceSchemaMap } from '../resources/registry';
import { defineTool, type ToolDefinition, type ToolPack } from './types';

type ToolResourceId =
    | 'tools.sample-tools.set'
    | 'tools.flow-design.set'
    | 'tools.node-config.set'
    | 'tools.task-graph.set';

type ToolSchemaMap = {
    [K in ToolResourceId]: ResourceSchemaMap[K];
};

export interface ToolDefinitionSeed {
    name: string;
    parameters: ToolDefinition['parameters'];
    executeId?: string;
}

export async function loadToolPackResource<K extends ToolResourceId>(id: K): Promise<ToolSchemaMap[K]> {
    return await loadResource(id);
}

export function buildToolPackFromResource(
    resource: ToolSchemaMap[ToolResourceId],
    definitionsByName: Record<string, ToolDefinitionSeed>,
): ToolPack {
    const tools = resource.tools.map(spec => {
        const definition = definitionsByName[spec.name];
        if (!definition) {
            throw new AgentError(`Tool definition not found for resource-backed tool: ${spec.name}`);
        }

        return defineTool({
            ...definition,
            description: spec.description,
            riskLevel: spec.riskLevel,
            allowedSkills: spec.allowedSkills,
            requiresConfirmation: spec.requiresConfirmation,
            parallelSafe: spec.parallelSafe,
            executeId: spec.executeId ?? definition.executeId,
        });
    });

    return {
        id: resource.id,
        version: resource.version,
        name: resource.name,
        description: resource.description,
        owner: resource.owner,
        scope: resource.scope,
        skills: resource.skills,
        bundle: {
            tools,
            executors: {},
        },
    };
}
