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

    const seenPortKeys = new Set<string>();
    for (const port of [...definition.inputs, ...definition.outputs]) {
        if (!port.key.trim()) {
            throw new AgentError(`Flow block port key must be a non-empty string: ${definition.id}`);
        }
        if (seenPortKeys.has(port.key)) {
            throw new AgentError(`Flow block port keys must be unique within a block: ${definition.id}:${port.key}`);
        }
        seenPortKeys.add(port.key);
    }

    return {
        ...definition,
        inputs: [...definition.inputs],
        outputs: [...definition.outputs],
    };
}

/**
 * Example text input block.
 *
 * This block models a user-provided text source. It exposes one output port
 * that emits the text entered by the user.
 */
export const TextInputBlock = defineFlowBlock({
    id: 'text-input',
    label: 'Text Input',
    description: 'Accepts user text and emits it through a single output port.',
    inputs: [],
    outputs: [
        {
            key: 'text',
            label: 'Text',
            direction: 'output',
            dataType: 'text',
            description: 'User-entered text payload.',
        },
    ],
});
