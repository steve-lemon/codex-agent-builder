// Shared catalog of built-in blocks and coarse capabilities used by flow-design layers.
import { AiGenerateBlock, BufferBlock, InputBlock, TextInputBlock, ViewBlock } from '../flow/blocks';

/** Built-in blocks currently available to flow-related design agents and tools. */
export const availableFlowBlocks = [TextInputBlock, InputBlock, BufferBlock, ViewBlock, AiGenerateBlock];

/** Coarse capability registry exposed by the currently available blocks. */
export const availableFlowCapabilities = [
    'text-input',
    'text-output',
    'delay',
    'view-log',
    'mock-ai-generation',
    'structured-output',
];

/** Capability map used for deterministic task-graph to block matching. */
export const flowBlockCapabilityMap: Record<string, string[]> = {
    'text-input': ['text-input'],
    input: ['text-input'],
    buffer: ['delay'],
    view: ['view-log', 'text-output'],
    'ai-generate': ['mock-ai-generation', 'structured-output', 'text-output'],
};
