// Reusable flow block helpers and built-in example block definitions.
import { AgentError } from '../errors/agent-error';
import type { FlowBlockDefinition } from './types';

/** Validates and returns a reusable flow block definition. */
export function defineFlowBlock(definition: FlowBlockDefinition): FlowBlockDefinition {
    if (!definition.id.trim()) {
        throw new AgentError('Flow block id must be a non-empty string');
    }
    if (!definition.label.trim()) {
        throw new AgentError(`Flow block label must be a non-empty string: ${definition.id}`);
    }

    const seenPortLocalIds = new Set<string>();
    for (const port of [...definition.inputs, ...definition.outputs]) {
        if (!port.localId.trim()) {
            throw new AgentError(`Flow block port localId must be a non-empty string: ${definition.id}`);
        }
        if (seenPortLocalIds.has(port.localId)) {
            throw new AgentError(
                `Flow block port localIds must be unique within a block: ${definition.id}:${port.localId}`,
            );
        }
        seenPortLocalIds.add(port.localId);
    }

    const seenConfigIds = new Set<string>();
    for (const config of definition.configs ?? []) {
        if (!config.id.trim()) {
            throw new AgentError(`Flow block config id must be a non-empty string: ${definition.id}`);
        }
        if (seenConfigIds.has(config.id)) {
            throw new AgentError(`Flow block config ids must be unique within a block: ${definition.id}:${config.id}`);
        }
        if (config.hint === 'select' && (!config.options || config.options.length === 0)) {
            throw new AgentError(`Flow select config must define options: ${definition.id}:${config.id}`);
        }
        seenConfigIds.add(config.id);
    }

    return {
        ...definition,
        configs: [...(definition.configs ?? [])],
        inputs: [...definition.inputs],
        outputs: [...definition.outputs],
    };
}
