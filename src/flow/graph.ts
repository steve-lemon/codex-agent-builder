// Flow-to-graph conversion helpers so flow documents can reuse graph planning.
import { planGraphExecution } from '../graph/planner';
import type { DirectedGraph, GraphExecutionPlan } from '../graph/types';
import type { FlowDocument } from './types';

/** Result of converting a flow document into the generic graph representation. */
export interface FlowGraphConversionResult {
    /** Graph view of the flow document that can be used by graph planners and executors. */
    graph: DirectedGraph;
}

/** Result of planning a flow document through the shared graph planner. */
export interface PlannedFlowGraph extends FlowGraphConversionResult {
    /** Execution plan produced from the converted flow graph. */
    plan: GraphExecutionPlan;
}

/**
 * Converts a flow document into the generic directed graph representation.
 *
 * Port-level constraints are intentionally ignored here. The resulting graph
 * keeps the existing graph concept: flow nodes become graph nodes, and flow
 * edges become node-to-node directed edges.
 */
export function convertFlowToGraph(flow: FlowDocument): FlowGraphConversionResult {
    const graph: DirectedGraph = {
        nodes: flow.nodes.map(node => ({
            id: node.id,
            label: node.label,
            data: {
                blockId: node.blockId,
                config: node.config,
                inputPortIds: node.inputPorts.map(port => port.id),
                outputPortIds: node.outputPorts.map(port => port.id),
            },
        })),
        edges: flow.edges.map(edge => ({
            source: edge.sourceNodeId,
            target: edge.targetNodeId,
            label: edge.label,
            data: {
                flowEdgeId: edge.id,
                sourcePortId: edge.sourcePortId,
                targetPortId: edge.targetPortId,
            },
        })),
    };

    return { graph };
}

/**
 * Converts a flow document into a graph and immediately produces an execution plan.
 *
 * This keeps the flow layer aligned with the existing graph planning model.
 */
export function planFlowGraph(flow: FlowDocument): PlannedFlowGraph {
    const { graph } = convertFlowToGraph(flow);
    return {
        graph,
        plan: planGraphExecution(graph),
    };
}
