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

/** Runtime status for one scheduled execution unit. */
export type GraphExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * Input passed to the application-defined node executor.
 *
 * The executor receives the current node together with the broader plan and the
 * already available upstream results so it can make deterministic decisions.
 */
export interface GraphNodeExecutionInput<TResult = unknown> {
    /** Stable id for the overall graph run. */
    runId: string;

    /** Stable id for the current execution unit. */
    executionId: string;

    /** Parent execution id when this node was delegated from an upstream branch. */
    parentExecutionId?: string;

    /** Depth in the execution tree. Root executions start at depth `0`. */
    depth: number;

    /** The node currently being executed. */
    node: GraphNode;

    /** The component that owns the current node. */
    component: GraphComponent;

    /** The original graph being executed. */
    graph: DirectedGraph;

    /** The precomputed execution plan for this graph. */
    plan: GraphExecutionPlan;

    /** Direct predecessor results that are available for this node. */
    predecessorResults: Record<string, TResult>;

    /** Snapshot of all completed node results at the time this node starts. */
    resultsByNode: Record<string, TResult>;
}

/**
 * One execution record in the runtime tree.
 *
 * A record represents the scheduling and lifecycle of one planned component.
 * When a node branches into multiple successors, each branch may create child
 * execution records under the current one.
 */
export interface GraphExecutionRecord {
    /** Stable execution id for this scheduled unit. */
    executionId: string;

    /** Parent execution id when this execution was spawned from another execution. */
    parentExecutionId?: string;

    /** Planned component id handled by this execution unit. */
    componentId: string;

    /** Node ids executed by this unit. Cycle components may contain multiple nodes. */
    nodeIds: string[];

    /** Depth in the execution tree. */
    depth: number;

    /** Current lifecycle status of the execution unit. */
    status: GraphExecutionStatus;

    /** Component ids that had to complete before this execution became runnable. */
    dependencyComponentIds: string[];

    /** Child execution ids spawned from this execution. */
    childExecutionIds: string[];

    /** Unix timestamp in milliseconds when the execution started. */
    startedAt?: number;

    /** Unix timestamp in milliseconds when the execution finished. */
    completedAt?: number;

    /** Error message captured when the execution failed. */
    error?: string;
}

/**
 * Runtime context passed to the node executor as the second argument.
 *
 * This object exposes execution metadata that is useful for tracing, logging,
 * stack reconstruction, and sharing stable run-scoped context across nodes.
 */
export interface GraphNodeExecutionContext<TSharedContext extends Record<string, unknown> = Record<string, never>> {
    /** Stable id for the overall graph run. */
    runId: string;

    /** Start node ids that defined the current execution scope. */
    startNodeIds: string[];

    /** Original input graph before any scope filtering was applied. */
    sourceGraph: DirectedGraph;

    /** Effective graph that is actually being executed. */
    graph: DirectedGraph;

    /** Execution plan used by the engine. */
    plan: GraphExecutionPlan;

    /** Execution record for the node currently being processed. */
    execution: GraphExecutionRecord;

    /** Parent execution record when the current execution was delegated from a branch. */
    parentExecution?: GraphExecutionRecord;

    /** Root-to-current execution stack. */
    executionStack: GraphExecutionRecord[];

    /** Shared run-scoped context supplied when the engine was created. */
    shared: TSharedContext;

    /** Returns the current timestamp in milliseconds using the engine clock. */
    now(): number;
}

/** Application-provided callback that performs the real work for one graph node. */
export type GraphNodeExecutor<
    TResult = unknown,
    TSharedContext extends Record<string, unknown> = Record<string, never>,
> = (input: GraphNodeExecutionInput<TResult>, context: GraphNodeExecutionContext<TSharedContext>) => Promise<TResult>;

/** Runtime options that control how the graph execution engine behaves. */
export interface GraphExecutionEngineConfig<TSharedContext extends Record<string, unknown> = Record<string, never>> {
    /** Maximum number of components that may run at the same time. */
    maxConcurrency?: number;

    /** Function used to generate timestamps for execution metadata. */
    now?: () => number;

    /** Optional prefix used when generating run and execution ids. */
    idPrefix?: string;

    /** Shared run-scoped context forwarded to every node execution. */
    sharedContext?: TSharedContext;
}

/** Options that define which portion of the graph should be executed. */
export interface GraphExecutionScope {
    /**
     * Node ids that act as entry points for this run.
     *
     * When omitted, the engine executes the full graph. When provided, the
     * engine executes only the selected nodes and everything reachable
     * downstream from them.
     */
    startNodeIds?: string[];
}

/**
 * Final result returned by the graph execution engine.
 *
 * This captures the graph, the derived plan, the execution tree, and the node
 * outputs so callers can inspect both behavior and business results.
 */
export interface GraphRunResult<TResult = unknown> {
    /** Stable id for this graph run. */
    runId: string;

    /** Final status of the graph run. */
    status: 'completed' | 'failed';

    /** Effective graph that was actually executed for this run. */
    graph: DirectedGraph;

    /** Original input graph before any start-node scoping was applied. */
    sourceGraph: DirectedGraph;

    /** Execution plan used for scheduling. */
    plan: GraphExecutionPlan;

    /** Start node ids used to derive the effective execution scope. */
    startNodeIds: string[];

    /** Final result of each completed node keyed by node id. */
    results: Record<string, TResult>;

    /** Execution records describing parent-child delegation across the run. */
    executions: GraphExecutionRecord[];

    /** Node ids in the order they completed. */
    executionOrder: string[];

    /** Unix timestamp in milliseconds when the run started. */
    startedAt: number;

    /** Unix timestamp in milliseconds when the run finished. */
    completedAt: number;

    /** Error message when the run fails. */
    error?: string;
}
