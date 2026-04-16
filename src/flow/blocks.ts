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
    configs: [
        {
            id: 'label',
            label: 'Prompt Label',
            hint: 'text',
            defaultValue: 'User Input',
        },
        {
            id: 'multiline',
            label: 'Multiline',
            hint: 'checkbox',
            defaultValue: 'false',
        },
    ],
    inputs: [],
    outputs: [
        {
            localId: 'text',
            label: 'Text',
            direction: 'output',
            dataType: 'text',
            description: 'User-entered text payload.',
        },
    ],
});

/** Sample block that emits its configured input string through one output port. */
export const InputBlock = defineFlowBlock({
    id: 'input',
    label: 'Input',
    description: 'Emits the configured input string as a packet on the output port.',
    configs: [
        {
            id: 'input',
            label: 'Input',
            hint: 'text',
            required: true,
        },
    ],
    inputs: [],
    outputs: [
        {
            localId: 'output',
            label: 'Output',
            direction: 'output',
            dataType: 'text',
        },
    ],
});

/** Sample block that forwards its input packet after waiting for the configured delay. */
export const BufferBlock = defineFlowBlock({
    id: 'buffer',
    label: 'Buffer',
    description: 'Waits for the configured duration, then forwards the input packet.',
    configs: [
        {
            id: 'wait',
            label: 'Wait (ms)',
            hint: 'number',
            required: true,
            defaultValue: '0',
        },
    ],
    inputs: [
        {
            localId: 'input',
            label: 'Input',
            direction: 'input',
            dataType: 'any',
        },
    ],
    outputs: [
        {
            localId: 'output',
            label: 'Output',
            direction: 'output',
            dataType: 'any',
        },
    ],
});

/** Sample block that logs the input packet value for inspection. */
export const ViewBlock = defineFlowBlock({
    id: 'view',
    label: 'View',
    description: 'Logs the current input packet value.',
    inputs: [
        {
            localId: 'input',
            label: 'Input',
            direction: 'input',
            dataType: 'any',
        },
    ],
    outputs: [],
});
