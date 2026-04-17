// Buffer block strategy for explicit and deterministic wait behavior.
import {
    applyNodeConfig,
    collectStrategyNotesFor,
    type NodeBlockConfigStrategy,
    type NodeBlockConfigStrategyContext,
    type NodeBlockConfigStrategyResult,
} from './shared';

/** Strategy for the buffer block that keeps timing deterministic and explicit. */
export class BufferNodeStrategy implements NodeBlockConfigStrategy {
    blockId = 'buffer';
    strategyId = 'buffer-timing';

    apply(
        node: Parameters<NodeBlockConfigStrategy['apply']>[0],
        context: NodeBlockConfigStrategyContext,
    ): NodeBlockConfigStrategyResult {
        const preferredWait = collectStrategyNotesFor(context.input, this.strategyId).find(note =>
            note.toLowerCase().includes('delay'),
        )
            ? '50'
            : node.config?.wait ?? '0';
        const config = {
            ...(node.config ?? {}),
            wait: preferredWait,
        };

        return {
            node: applyNodeConfig(node, config),
            suggestion: {
                nodeId: node.id,
                blockId: node.blockId,
                strategyId: this.strategyId,
                config,
                rationale: [
                    'Ensure buffer nodes have an explicit wait configuration for deterministic execution.',
                    ...(collectStrategyNotesFor(context.input, this.strategyId).length > 0
                        ? [
                              `Respect timing-oriented strategy notes: ${collectStrategyNotesFor(
                                  context.input,
                                  this.strategyId,
                              ).join(' | ')}`,
                          ]
                        : []),
                ],
            },
        };
    }
}
