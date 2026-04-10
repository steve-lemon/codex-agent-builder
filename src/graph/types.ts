// Graph data types and execution-plan contracts.

/** A graph node that may participate in execution planning. */
export interface GraphNode {
    id: string;
    label?: string;
    data?: Record<string, unknown>;
}

/** A directed edge where `source -> target` means source must run before target when acyclic. */
export interface GraphEdge {
    source: string;
    target: string;
    label?: string;
    data?: Record<string, unknown>;
}

/** In-memory graph representation used by the planner. */
export interface DirectedGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

/** A strongly connected component collapsed during planning. */
export interface GraphComponent {
    id: string;
    nodeIds: string[];
    inCycle: boolean;
}

/** Execution metadata assigned to a single node. */
export interface PlannedGraphNode {
    nodeId: string;
    componentId: string;
    batch: number;
    priority: number;
    inCycle: boolean;
    predecessorIds: string[];
    successorIds: string[];
}

/** A batch of nodes that can be executed in parallel. */
export interface ExecutionBatch {
    batch: number;
    nodeIds: string[];
    componentIds: string[];
}

/** Graph execution plan derived from a directed graph. */
export interface GraphExecutionPlan {
    nodes: PlannedGraphNode[];
    batches: ExecutionBatch[];
    components: GraphComponent[];
    hasCycles: boolean;
}
