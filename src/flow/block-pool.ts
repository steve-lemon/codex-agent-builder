import { AgentError } from '../errors/agent-error';
import { loadResource } from '../resources/loader';
import type { FlowBlockDefinition, FlowCapabilityDefinition } from './types';
import { defineFlowBlock } from './blocks';
import type { FlowBlockPoolRecord } from './resource-schemas';

export const BuiltinFlowBlockIds = {
    textInput: 'text-input',
    input: 'input',
    buffer: 'buffer',
    view: 'view',
    aiGenerate: 'ai-generate',
} as const;

export interface FlowBlockPool {
    version: number;
    capabilities: FlowCapabilityDefinition[];
    blocks: FlowBlockDefinition[];
    matching: FlowBlockPoolRecord['matching'];
}

export async function getFlowBlockPool(): Promise<FlowBlockPool> {
    const resource: FlowBlockPoolRecord = await loadResource('flow.block-pool');
    const capabilityIds = new Set(resource.capabilities.map(capability => capability.id));
    const blocks = resource.blocks.map(block => defineFlowBlock(block));

    for (const block of blocks) {
        for (const capabilityId of block.capabilities ?? []) {
            if (!capabilityIds.has(capabilityId)) {
                throw new AgentError(`Flow block references unknown capability: ${block.id}:${capabilityId}`);
            }
        }
    }

    return {
        version: resource.version,
        capabilities: resource.capabilities,
        blocks,
        matching: resource.matching,
    };
}

export async function getBuiltinFlowBlocks(): Promise<FlowBlockDefinition[]> {
    return (await getFlowBlockPool()).blocks;
}

export async function getBuiltinFlowBlock(blockId: string): Promise<FlowBlockDefinition> {
    const block = (await getFlowBlockPool()).blocks.find(candidate => candidate.id === blockId);
    if (!block) {
        throw new AgentError(`Built-in flow block not found: ${blockId}`);
    }
    return block;
}

export async function getFlowCapabilityDefinitions(): Promise<FlowCapabilityDefinition[]> {
    return (await getFlowBlockPool()).capabilities;
}

export async function getFlowCapabilityCategoryMap(): Promise<Record<string, FlowCapabilityDefinition['category']>> {
    return Object.fromEntries(
        (await getFlowCapabilityDefinitions()).map(capability => [capability.id, capability.category]),
    );
}

export async function getFlowBlockMatchingPolicy(): Promise<FlowBlockPoolRecord['matching']> {
    // TODO(flow): Allow manifest version-specific migration for matching policy
    // so older block-pool resources can evolve without breaking selection rules.
    return (await getFlowBlockPool()).matching;
}

export async function getAvailableFlowCapabilities(): Promise<string[]> {
    return [...new Set((await getBuiltinFlowBlocks()).flatMap(block => block.capabilities ?? []))];
}

export async function getFlowBlockCapabilityMap(): Promise<Record<string, string[]>> {
    return Object.fromEntries((await getBuiltinFlowBlocks()).map(block => [block.id, [...(block.capabilities ?? [])]]));
}
