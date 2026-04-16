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
    nodeConfigStrategyId: 'generic-text-input',
    nodeConfigGuidance: {
        sharedNotes: ['Keep text-input labels descriptive so upstream intent is obvious in the editor.'],
    },
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
    nodeConfigStrategyId: 'prompt-input-family',
    nodeConfigGuidance: {
        sharedNotes: ['Input blocks should carry explicit user-facing wording instead of placeholder text.'],
        strategyDirectives: [
            {
                strategyId: 'system-input',
                note: 'Use this block to encode stable global instructions for downstream AI behavior.',
            },
            {
                strategyId: 'prompt-input',
                note: 'Use this block to encode request-specific wording, count, and output format expectations.',
            },
        ],
    },
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
    nodeConfigStrategyId: 'buffer-timing',
    nodeConfigGuidance: {
        sharedNotes: ['Buffer blocks should make timing explicit so retries stay deterministic.'],
        strategyDirectives: [
            {
                strategyId: 'buffer-timing',
                note: 'Prefer small explicit wait values over implicit timing assumptions.',
            },
        ],
    },
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
    nodeConfigStrategyId: 'view-observer',
    nodeConfigGuidance: {
        sharedNotes: ['View blocks are for observability, so keep them placed where final output remains visible.'],
        strategyDirectives: [
            {
                strategyId: 'view-observer',
                note: 'Use this block to preserve operator visibility into final or intermediate outputs.',
            },
        ],
    },
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

/**
 * Sample AI generation block for concept validation.
 *
 * The runtime implementation is intentionally mocked so the flow contract can
 * be validated before wiring a real LLM provider.
 */
export const AiGenerateBlock = defineFlowBlock({
    id: 'ai-generate',
    label: 'AI Generate',
    description: 'Consumes system and prompt text, then emits a mocked model response.',
    nodeConfigStrategyId: 'ai-generation',
    nodeConfigGuidance: {
        sharedNotes: ['AI blocks should align model profile, prompt wording, and output mode with the request intent.'],
        strategyDirectives: [
            {
                strategyId: 'ai-generation',
                note: 'Prefer structured-output capable models when the flow expects JSON-shaped downstream handling.',
            },
            {
                strategyId: 'ai-generation',
                note: 'Keep system and prompt wording consistent with the chosen model profile.',
            },
        ],
    },
    configs: [
        {
            id: 'model',
            label: 'Model',
            hint: 'text',
            required: true,
            defaultValue: 'mock-gpt',
        },
        {
            id: 'jsonOutput',
            label: 'JSON Output',
            hint: 'checkbox',
            defaultValue: 'false',
        },
    ],
    inputs: [
        {
            localId: 'system',
            label: 'System',
            direction: 'input',
            dataType: 'text',
        },
        {
            localId: 'prompt',
            label: 'Prompt',
            direction: 'input',
            dataType: 'text',
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
