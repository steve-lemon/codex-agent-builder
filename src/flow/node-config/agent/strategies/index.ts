// Public strategy exports for the node-configuration sub-agent.
export * from './shared';
export * from './input';
export * from './ai';
export * from './buffer';
export * from './view';

import type { NodeBlockConfigStrategy } from './shared';
import { SystemInputNodeStrategy, PromptInputNodeStrategy } from './input';
import { AiGenerateNodeStrategy } from './ai';
import { BufferNodeStrategy } from './buffer';
import { ViewNodeStrategy } from './view';

/** Returns the default block-specific strategy set used by the node-config sub-agent. */
export function createDefaultNodeBlockConfigStrategies(): NodeBlockConfigStrategy[] {
    return [
        new SystemInputNodeStrategy(),
        new PromptInputNodeStrategy(),
        new AiGenerateNodeStrategy(),
        new BufferNodeStrategy(),
        new ViewNodeStrategy(),
    ];
}
