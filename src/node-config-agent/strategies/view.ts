// View block strategy for output observability and inspection.
import { type NodeBlockConfigStrategy, type NodeBlockConfigStrategyResult } from './shared';

/** Strategy for view blocks that are primarily used for output inspection/logging. */
export class ViewNodeStrategy implements NodeBlockConfigStrategy {
    blockId = 'view';
    strategyId = 'view-observer';

    apply(node: Parameters<NodeBlockConfigStrategy['apply']>[0]): NodeBlockConfigStrategyResult {
        return {
            node,
            suggestion: {
                nodeId: node.id,
                blockId: node.blockId,
                config: node.config ?? {},
                rationale: ['Keep the view node focused on output inspection so the final sample remains observable.'],
            },
        };
    }
}
