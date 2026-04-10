// Graph data types and execution-plan contracts.

/**
 * Represents one node in the directed graph.
 *
 * A node is the smallest execution unit the planner reasons about. Nodes may
 * later be grouped into a cycle component when the graph contains loops.
 */
export interface GraphNode {
    /** Stable unique identifier used by edges, plans, and renderers. */
    id: string;

    /** Optional human-friendly label shown in visual renderers such as Mermaid. */
    label?: string;

    /** Optional application-specific payload associated with the node. */
    data?: Record<string, unknown>;
}

/**
 * Represents one directed connection between two nodes.
 *
 * `source -> target` means data, dependency, or control flow moves from the
 * source node to the target node. In an acyclic path, the source must be
 * planned before the target.
 */
export interface GraphEdge {
    /** The upstream node id where the edge starts. */
    source: string;

    /** The downstream node id where the edge ends. */
    target: string;

    /** Optional human-friendly label for the connection. */
    label?: string;

    /** Optional application-specific payload associated with the edge. */
    data?: Record<string, unknown>;
}

/**
 * In-memory representation of the full directed graph.
 *
 * The planner reads this structure as input and validates that all edges point
 * to known nodes and that self-referential edges are not present.
 */
export interface DirectedGraph {
    /** All nodes that belong to the graph. */
    nodes: GraphNode[];

    /** All directed edges connecting the nodes. */
    edges: GraphEdge[];
}

/**
 * Describes a strongly connected component discovered during planning.
 *
 * When the graph contains a loop such as `A -> B -> A`, the planner collapses
 * those nodes into one component so the cycle can be scheduled as a single
 * execution unit.
 */
export interface GraphComponent {
    /** Synthetic component id assigned by the planner. */
    id: string;

    /** Node ids that belong to this component. */
    nodeIds: string[];

    /** Indicates whether this component represents a cycle rather than a single acyclic node. */
    inCycle: boolean;
}

/**
 * Execution metadata for a single node after planning has completed.
 *
 * This is the per-node view of the plan and is useful when an executor needs
 * to understand where one node sits relative to the rest of the graph.
 */
export interface PlannedGraphNode {
    /** The node id from the original graph. */
    nodeId: string;

    /** The component id the node belongs to after cycle collapsing. */
    componentId: string;

    /** Zero-based batch number. Nodes in the same batch may run in parallel. */
    batch: number;

    /** Relative execution rank where lower values are scheduled earlier. */
    priority: number;

    /** True when the node belongs to a loop component. */
    inCycle: boolean;

    /** Direct predecessor node ids from the original graph. */
    predecessorIds: string[];

    /** Direct successor node ids from the original graph. */
    successorIds: string[];
}

/**
 * A parallelizable execution batch produced by the planner.
 *
 * Each batch contains nodes whose dependencies have already been satisfied by
 * earlier batches, so they can be dispatched together.
 */
export interface ExecutionBatch {
    /** Zero-based batch number in execution order. */
    batch: number;

    /** Node ids scheduled to run in this batch. */
    nodeIds: string[];

    /** Component ids represented in this batch. Useful when cycles were collapsed. */
    componentIds: string[];
}

/**
 * Final execution plan derived from a directed graph.
 *
 * This structure contains both the batch-oriented view used by executors and
 * the node/component metadata used by diagnostics, tracing, and renderers.
 */
export interface GraphExecutionPlan {
    /** Per-node execution metadata keyed as an array for simple iteration and serialization. */
    nodes: PlannedGraphNode[];

    /** Ordered execution batches. Earlier batches must complete before later ones start. */
    batches: ExecutionBatch[];

    /** Strongly connected components discovered while planning. */
    components: GraphComponent[];

    /** True when the original graph contained at least one cycle. */
    hasCycles: boolean;
}
