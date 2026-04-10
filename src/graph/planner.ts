// Graph validation and SCC-based execution planning.
import { AgentError } from '../errors/agent-error';
import type {
    DirectedGraph,
    ExecutionBatch,
    GraphComponent,
    GraphExecutionPlan,
    GraphEdge,
    GraphNode,
    PlannedGraphNode,
} from './types';

interface AdjacencyState {
    adjacency: Map<string, string[]>;
    incoming: Map<string, string[]>;
    edgeKeys: Set<string>;
    nodesById: Map<string, GraphNode>;
}

interface TarjanState {
    index: number;
    indices: Map<string, number>;
    lowLinks: Map<string, number>;
    stack: string[];
    onStack: Set<string>;
    components: string[][];
}

/** Plans execution order for a directed graph while tolerating loops by collapsing SCCs. */
export class GraphExecutionPlanner {
    plan(graph: DirectedGraph): GraphExecutionPlan {
        const state = this.validateGraph(graph);
        const rawComponents = this.computeStronglyConnectedComponents(graph.nodes, state.adjacency);
        const components = rawComponents.map((nodeIds, index) => ({
            id: `component_${index + 1}`,
            nodeIds: [...nodeIds].sort(),
            inCycle: nodeIds.length > 1,
        }));
        const componentByNode = new Map<string, GraphComponent>();

        for (const component of components) {
            for (const nodeId of component.nodeIds) {
                componentByNode.set(nodeId, component);
            }
        }

        const componentAdjacency = new Map<string, Set<string>>();
        const componentIncomingCounts = new Map<string, number>();
        for (const component of components) {
            componentAdjacency.set(component.id, new Set());
            componentIncomingCounts.set(component.id, 0);
        }

        for (const edge of graph.edges) {
            const sourceComponent = componentByNode.get(edge.source)!;
            const targetComponent = componentByNode.get(edge.target)!;

            if (sourceComponent.id === targetComponent.id) {
                continue;
            }

            const outgoing = componentAdjacency.get(sourceComponent.id)!;
            if (!outgoing.has(targetComponent.id)) {
                outgoing.add(targetComponent.id);
                componentIncomingCounts.set(
                    targetComponent.id,
                    (componentIncomingCounts.get(targetComponent.id) ?? 0) + 1,
                );
            }
        }

        const batches = this.buildBatches(components, componentAdjacency, componentIncomingCounts);
        const plannedNodes = this.buildPlannedNodes(graph, state, componentByNode, batches);

        return {
            nodes: plannedNodes,
            batches,
            components,
            hasCycles: components.some(component => component.inCycle),
        };
    }

    private validateGraph(graph: DirectedGraph): AdjacencyState {
        const nodesById = new Map<string, GraphNode>();
        const adjacency = new Map<string, string[]>();
        const incoming = new Map<string, string[]>();
        const edgeKeys = new Set<string>();

        for (const node of graph.nodes) {
            if (!node.id.trim()) {
                throw new AgentError('Graph node id must be a non-empty string');
            }
            if (nodesById.has(node.id)) {
                throw new AgentError(`Graph node id must be unique: ${node.id}`);
            }
            nodesById.set(node.id, node);
            adjacency.set(node.id, []);
            incoming.set(node.id, []);
        }

        for (const edge of graph.edges) {
            if (edge.source === edge.target) {
                throw new AgentError(`Self edges are not supported: ${edge.source} -> ${edge.target}`);
            }
            if (!nodesById.has(edge.source)) {
                throw new AgentError(`Edge source node not found: ${edge.source}`);
            }
            if (!nodesById.has(edge.target)) {
                throw new AgentError(`Edge target node not found: ${edge.target}`);
            }

            const edgeKey = `${edge.source}->${edge.target}`;
            if (edgeKeys.has(edgeKey)) {
                continue;
            }
            edgeKeys.add(edgeKey);
            adjacency.get(edge.source)!.push(edge.target);
            incoming.get(edge.target)!.push(edge.source);
        }

        for (const targets of adjacency.values()) {
            targets.sort();
        }
        for (const sources of incoming.values()) {
            sources.sort();
        }

        return {
            adjacency,
            incoming,
            edgeKeys,
            nodesById,
        };
    }

    private computeStronglyConnectedComponents(nodes: GraphNode[], adjacency: Map<string, string[]>): string[][] {
        const state: TarjanState = {
            index: 0,
            indices: new Map(),
            lowLinks: new Map(),
            stack: [],
            onStack: new Set(),
            components: [],
        };

        const strongConnect = (nodeId: string) => {
            state.indices.set(nodeId, state.index);
            state.lowLinks.set(nodeId, state.index);
            state.index += 1;
            state.stack.push(nodeId);
            state.onStack.add(nodeId);

            for (const neighborId of adjacency.get(nodeId) ?? []) {
                if (!state.indices.has(neighborId)) {
                    strongConnect(neighborId);
                    state.lowLinks.set(nodeId, Math.min(state.lowLinks.get(nodeId)!, state.lowLinks.get(neighborId)!));
                } else if (state.onStack.has(neighborId)) {
                    state.lowLinks.set(nodeId, Math.min(state.lowLinks.get(nodeId)!, state.indices.get(neighborId)!));
                }
            }

            if (state.lowLinks.get(nodeId) === state.indices.get(nodeId)) {
                const component: string[] = [];
                let current = '';
                do {
                    current = state.stack.pop()!;
                    state.onStack.delete(current);
                    component.push(current);
                } while (current !== nodeId);
                state.components.push(component);
            }
        };

        for (const node of [...nodes].sort((left, right) => left.id.localeCompare(right.id))) {
            if (!state.indices.has(node.id)) {
                strongConnect(node.id);
            }
        }

        return state.components;
    }

    private buildBatches(
        components: GraphComponent[],
        componentAdjacency: Map<string, Set<string>>,
        componentIncomingCounts: Map<string, number>,
    ): ExecutionBatch[] {
        const pendingIncoming = new Map(componentIncomingCounts);
        const batches: ExecutionBatch[] = [];
        let current = components
            .filter(component => (pendingIncoming.get(component.id) ?? 0) === 0)
            .map(component => component.id)
            .sort();
        let batchIndex = 0;
        let plannedComponentCount = 0;

        while (current.length > 0) {
            batchIndex += 1;
            const batchComponentIds = [...current].sort();
            plannedComponentCount += batchComponentIds.length;
            batches.push({
                batch: batchIndex,
                componentIds: batchComponentIds,
                nodeIds: batchComponentIds.flatMap(
                    componentId => components.find(component => component.id === componentId)!.nodeIds,
                ),
            });

            const nextSet = new Set<string>();
            for (const componentId of batchComponentIds) {
                for (const neighborId of componentAdjacency.get(componentId) ?? []) {
                    const nextIncoming = (pendingIncoming.get(neighborId) ?? 0) - 1;
                    pendingIncoming.set(neighborId, nextIncoming);
                    if (nextIncoming === 0) {
                        nextSet.add(neighborId);
                    }
                }
            }

            current = [...nextSet].sort();
        }

        if (plannedComponentCount !== components.length) {
            throw new AgentError('Failed to build execution batches for the graph');
        }

        return batches;
    }

    private buildPlannedNodes(
        graph: DirectedGraph,
        state: AdjacencyState,
        componentByNode: Map<string, GraphComponent>,
        batches: ExecutionBatch[],
    ): PlannedGraphNode[] {
        const batchByComponent = new Map<string, number>();
        for (const batch of batches) {
            for (const componentId of batch.componentIds) {
                batchByComponent.set(componentId, batch.batch);
            }
        }

        return [...graph.nodes]
            .sort((left, right) => left.id.localeCompare(right.id))
            .map(node => {
                const component = componentByNode.get(node.id)!;
                const batch = batchByComponent.get(component.id)!;

                return {
                    nodeId: node.id,
                    componentId: component.id,
                    batch,
                    priority: batch,
                    inCycle: component.inCycle,
                    predecessorIds: [...(state.incoming.get(node.id) ?? [])],
                    successorIds: [...(state.adjacency.get(node.id) ?? [])],
                };
            });
    }
}

/** Convenience helper for one-shot planning. */
export function planGraphExecution(graph: DirectedGraph): GraphExecutionPlan {
    return new GraphExecutionPlanner().plan(graph);
}
