// Flow-to-graph conversion helpers so flow documents can reuse graph planning.
import { planGraphExecution } from '../graph/planner';
import type { DirectedGraph, GraphExecutionPlan } from '../graph/types';
import type { FlowDocument, FlowEdge, FlowNode } from './types';

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
 * Base class for adapting flow documents into the shared graph model.
 *
 * This keeps the higher-level conversion contract stable while subclasses can
 * enrich graph metadata for a specific runtime or editor integration.
 */
export abstract class FlowGraphAdapter {
    convert(flow: FlowDocument): FlowGraphConversionResult {
        return {
            graph: {
                nodes: flow.nodes.map(node => this.toGraphNode(node)),
                edges: flow.edges.map(edge => this.toGraphEdge(edge)),
            },
        };
    }

    plan(flow: FlowDocument): PlannedFlowGraph {
        const { graph } = this.convert(flow);

        // TODO(flow): Allow flow-specific planning hints such as pinned start
        // nodes, disabled branches, and editor-driven execution scopes.
        return {
            graph,
            plan: planGraphExecution(graph),
        };
    }

    protected toGraphNode(node: FlowNode): DirectedGraph['nodes'][number] {
        return {
            id: node.id,
            label: node.label,
            data: {
                blockId: node.blockId,
                config: node.config,
                inputPortIds: node.inputPorts.map(port => port.id),
                outputPortIds: node.outputPorts.map(port => port.id),
            },
        };
    }

    protected toGraphEdge(edge: FlowEdge): DirectedGraph['edges'][number] {
        return {
            source: edge.sourceNodeId,
            target: edge.targetNodeId,
            label: edge.label,
            data: {
                flowEdgeId: edge.id,
                sourcePortId: edge.sourcePortId,
                targetPortId: edge.targetPortId,
            },
        };
    }

    // TODO(flow): Reintroduce optional port-level planning semantics here if
    // future runtimes need join conditions based on specific input ports.
}

/** Default adapter that preserves the current flow-to-graph mapping. */
export class DefaultFlowGraphAdapter extends FlowGraphAdapter {}

const defaultFlowGraphAdapter = new DefaultFlowGraphAdapter();

/** Converts a flow document into the generic directed graph representation. */
export function convertFlowToGraph(flow: FlowDocument): FlowGraphConversionResult {
    return defaultFlowGraphAdapter.convert(flow);
}

/** Converts a flow document into a graph and immediately produces an execution plan. */
export function planFlowGraph(flow: FlowDocument): PlannedFlowGraph {
    return defaultFlowGraphAdapter.plan(flow);
}
