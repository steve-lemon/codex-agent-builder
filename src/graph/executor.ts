// Graph execution engine that schedules planned components with branch delegation.
import { AgentError } from '../errors/agent-error';
import { now as defaultNow } from '../time/now';
import { planGraphExecution } from './planner';
import type {
    DirectedGraph,
    GraphComponent,
    GraphExecutionEngineConfig,
    GraphExecutionEvent,
    GraphExecutionEventHandler,
    GraphExecutionPlan,
    GraphExecutionRecord,
    GraphExecutionScope,
    GraphNode,
    GraphNodeExecutionContext,
    GraphNodeExecutionInput,
    GraphNodeExecutor,
    GraphRunResult,
} from './types';

interface SchedulerTask {
    componentId: string;
    parentExecutionId?: string;
    depth: number;
    concurrencyKey?: string;
}

interface PreparedGraphState<TResult> {
    graph: DirectedGraph;
    plan: GraphExecutionPlan;
    nodeById: Map<string, GraphNode>;
    componentById: Map<string, GraphComponent>;
    componentByNode: Map<string, GraphComponent>;
    outgoingComponents: Map<string, string[]>;
    incomingComponents: Map<string, string[]>;
    incomingNodesByNode: Map<string, string[]>;
    incomingRemaining: Map<string, number>;
    results: Map<string, TResult>;
    executionOrder: string[];
    executionRecords: Map<string, GraphExecutionRecord>;
    executionList: GraphExecutionRecord[];
    scheduledComponents: Set<string>;
    completedComponents: Set<string>;
}

/**
 * Executes a planned graph while preserving branch delegation as child executions.
 *
 * The engine schedules strongly connected components rather than raw nodes so
 * loops can be executed once without deadlocking on circular dependencies.
 */
export class GraphExecutionEngine<
    TResult = unknown,
    TSharedContext extends Record<string, unknown> = Record<string, never>,
> {
    private readonly maxConcurrency: number;
    private readonly nodeTimeoutMs?: number;
    private readonly resolveNodeTimeoutMs?: GraphExecutionEngineConfig<TSharedContext>['resolveNodeTimeoutMs'];
    private readonly maxConcurrencyByKey: Record<string, number>;
    private readonly resolveConcurrencyKey?: GraphExecutionEngineConfig<TSharedContext>['resolveConcurrencyKey'];
    private readonly now: () => number;
    private readonly idPrefix: string;
    private readonly sharedContext: TSharedContext;
    private readonly signal?: AbortSignal;
    private readonly onEvent?: GraphExecutionEventHandler;

    constructor(
        private readonly executeNode: GraphNodeExecutor<TResult, TSharedContext>,
        config: GraphExecutionEngineConfig<TSharedContext> = {},
    ) {
        this.maxConcurrency = Math.max(1, config.maxConcurrency ?? 4);
        this.nodeTimeoutMs = config.nodeTimeoutMs;
        this.resolveNodeTimeoutMs = config.resolveNodeTimeoutMs;
        this.maxConcurrencyByKey = config.maxConcurrencyByKey ?? {};
        this.resolveConcurrencyKey = config.resolveConcurrencyKey;
        this.now = config.now ?? defaultNow;
        this.idPrefix = config.idPrefix ?? 'graph-run';
        this.sharedContext = (config.sharedContext ?? {}) as TSharedContext;
        this.signal = config.signal;
        this.onEvent = config.onEvent;
    }

    async execute(graph: DirectedGraph, plan = planGraphExecution(graph)): Promise<GraphRunResult<TResult>> {
        return await this.executeScoped(graph, {}, plan);
    }

    async executeFrom(
        graph: DirectedGraph,
        scope: GraphExecutionScope,
        plan?: GraphExecutionPlan,
    ): Promise<GraphRunResult<TResult>> {
        return await this.executeScoped(graph, scope, plan);
    }

    private async executeScoped(
        sourceGraph: DirectedGraph,
        scope: GraphExecutionScope,
        providedPlan?: GraphExecutionPlan,
    ): Promise<GraphRunResult<TResult>> {
        const startedAt = this.now();
        const runId = `${this.idPrefix}:${startedAt}`;
        const { graph, startNodeIds } = this.buildExecutionGraph(sourceGraph, scope);
        const plan = providedPlan ?? planGraphExecution(graph);
        const state = this.prepare(graph, plan);
        this.emitEvent({
            runId,
            type: 'run_started',
            timestamp: startedAt,
            message: 'Graph execution started',
            data: {
                startNodeIds,
                nodeCount: graph.nodes.length,
                edgeCount: graph.edges.length,
            },
        });
        const readyQueue: SchedulerTask[] = state.plan.components
            .filter(component => (state.incomingRemaining.get(component.id) ?? 0) === 0)
            .sort((left, right) => left.id.localeCompare(right.id))
            .map(component => this.createSchedulerTask(component.id, 0, undefined, state));

        let activeCount = 0;
        let nextExecutionNo = 0;
        const activeCountByKey = new Map<string, number>();

        const createExecutionId = (): string => {
            nextExecutionNo += 1;
            return `${runId}:exec:${nextExecutionNo}`;
        };

        const createRecord = (task: SchedulerTask): GraphExecutionRecord => {
            const component = state.componentById.get(task.componentId)!;
            const record: GraphExecutionRecord = {
                executionId: createExecutionId(),
                parentExecutionId: task.parentExecutionId,
                componentId: task.componentId,
                nodeIds: [...component.nodeIds],
                depth: task.depth,
                status: 'pending',
                dependencyComponentIds: [...(state.incomingComponents.get(task.componentId) ?? [])],
                childExecutionIds: [],
            };
            state.executionRecords.set(record.executionId, record);
            state.executionList.push(record);
            if (task.parentExecutionId) {
                state.executionRecords.get(task.parentExecutionId)?.childExecutionIds.push(record.executionId);
            }
            return record;
        };

        return await new Promise<GraphRunResult<TResult>>(resolve => {
            let settled = false;

            const snapshotExecutions = (): GraphExecutionRecord[] =>
                state.executionList.map(record => ({
                    ...record,
                    nodeIds: [...record.nodeIds],
                    dependencyComponentIds: [...record.dependencyComponentIds],
                    childExecutionIds: [...record.childExecutionIds],
                }));

            const cancel = (message: string) => {
                if (settled) {
                    return;
                }
                settled = true;
                this.emitEvent({
                    runId,
                    type: 'run_cancelled',
                    timestamp: this.now(),
                    message,
                });
                resolve({
                    runId,
                    status: 'cancelled',
                    graph,
                    sourceGraph,
                    plan,
                    startNodeIds,
                    results: Object.fromEntries(state.results),
                    executions: snapshotExecutions().map(record =>
                        record.status === 'pending' || record.status === 'running'
                            ? {
                                  ...record,
                                  status: 'cancelled',
                                  completedAt: record.completedAt ?? this.now(),
                              }
                            : record,
                    ),
                    executionOrder: [...state.executionOrder],
                    startedAt,
                    completedAt: this.now(),
                    error: message,
                });
            };

            const fail = (error: unknown) => {
                if (settled) {
                    return;
                }
                settled = true;
                const wrapped = AgentError.from(error, 'Graph execution failed');
                this.emitEvent({
                    runId,
                    type: 'run_failed',
                    timestamp: this.now(),
                    message: wrapped.message,
                });
                resolve({
                    runId,
                    status: 'failed',
                    graph,
                    sourceGraph,
                    plan,
                    startNodeIds,
                    results: Object.fromEntries(state.results),
                    executions: snapshotExecutions(),
                    executionOrder: [...state.executionOrder],
                    startedAt,
                    completedAt: this.now(),
                    error: wrapped.message,
                });
            };

            const maybeComplete = () => {
                if (settled) {
                    return;
                }
                if (activeCount > 0 || readyQueue.length > 0) {
                    return;
                }
                if (state.completedComponents.size !== state.plan.components.length) {
                    fail(new AgentError('Graph execution stalled before all components completed'));
                    return;
                }

                settled = true;
                this.emitEvent({
                    runId,
                    type: 'run_completed',
                    timestamp: this.now(),
                    message: 'Graph execution completed',
                    data: {
                        completedNodes: state.executionOrder.length,
                    },
                });
                resolve({
                    runId,
                    status: 'completed',
                    graph,
                    sourceGraph,
                    plan,
                    startNodeIds,
                    results: Object.fromEntries(state.results),
                    executions: snapshotExecutions(),
                    executionOrder: [...state.executionOrder],
                    startedAt,
                    completedAt: this.now(),
                });
            };

            const enqueueReadyComponent = (task: SchedulerTask) => {
                if (state.scheduledComponents.has(task.componentId)) {
                    return;
                }
                state.scheduledComponents.add(task.componentId);
                readyQueue.push(task);
                readyQueue.sort((left, right) => left.componentId.localeCompare(right.componentId));
            };

            const runComponent = async (task: SchedulerTask, record: GraphExecutionRecord) => {
                this.throwIfAborted();
                const component = state.componentById.get(task.componentId)!;
                record.status = 'running';
                record.startedAt = this.now();
                this.emitEvent({
                    runId,
                    type: 'component_started',
                    timestamp: record.startedAt,
                    executionId: record.executionId,
                    componentId: component.id,
                    message: `Component ${component.id} started`,
                    data: {
                        nodeIds: component.nodeIds,
                    },
                });

                for (const nodeId of component.nodeIds) {
                    if (settled) {
                        return;
                    }
                    this.throwIfAborted();
                    const node = state.nodeById.get(nodeId)!;
                    const predecessorResults = this.buildPredecessorResults(
                        nodeId,
                        state.incomingNodesByNode,
                        state.results,
                    );
                    const input: GraphNodeExecutionInput<TResult> = {
                        runId,
                        executionId: record.executionId,
                        parentExecutionId: record.parentExecutionId,
                        depth: record.depth,
                        node,
                        component,
                        graph,
                        plan,
                        predecessorResults,
                        resultsByNode: Object.fromEntries(state.results),
                    };
                    this.emitEvent({
                        runId,
                        type: 'node_started',
                        timestamp: this.now(),
                        executionId: record.executionId,
                        componentId: component.id,
                        nodeId,
                        message: `Node ${nodeId} started`,
                    });
                    const context = this.buildExecutionContext(
                        runId,
                        sourceGraph,
                        graph,
                        plan,
                        startNodeIds,
                        state.executionRecords,
                        record,
                    );
                    const timeoutMs = this.resolveEffectiveNodeTimeoutMs(input, context);
                    const result = await this.executeNodeWithTimeout(input, context, timeoutMs);
                    if (settled) {
                        return;
                    }
                    state.results.set(nodeId, result);
                    state.executionOrder.push(nodeId);
                    this.emitEvent({
                        runId,
                        type: 'node_completed',
                        timestamp: this.now(),
                        executionId: record.executionId,
                        componentId: component.id,
                        nodeId,
                        message: `Node ${nodeId} completed`,
                    });
                }

                if (settled) {
                    return;
                }
                record.status = 'completed';
                record.completedAt = this.now();
                state.completedComponents.add(component.id);
                this.emitEvent({
                    runId,
                    type: 'component_completed',
                    timestamp: record.completedAt,
                    executionId: record.executionId,
                    componentId: component.id,
                    message: `Component ${component.id} completed`,
                });

                for (const nextComponentId of state.outgoingComponents.get(component.id) ?? []) {
                    const remaining = (state.incomingRemaining.get(nextComponentId) ?? 0) - 1;
                    state.incomingRemaining.set(nextComponentId, remaining);
                    if (remaining === 0) {
                        enqueueReadyComponent({
                            ...this.createSchedulerTask(nextComponentId, record.depth + 1, record.executionId, state),
                        });
                    }
                }
            };

            const pump = () => {
                if (settled) {
                    return;
                }
                if (this.signal?.aborted) {
                    cancel(
                        this.signal.reason instanceof Error ? this.signal.reason.message : 'Graph execution cancelled',
                    );
                    return;
                }

                while (activeCount < this.maxConcurrency) {
                    const nextTaskIndex = this.findRunnableTaskIndex(readyQueue, activeCountByKey);
                    if (nextTaskIndex === -1) {
                        break;
                    }
                    const [task] = readyQueue.splice(nextTaskIndex, 1);
                    const record = createRecord(task);
                    activeCount += 1;
                    if (task.concurrencyKey) {
                        activeCountByKey.set(task.concurrencyKey, (activeCountByKey.get(task.concurrencyKey) ?? 0) + 1);
                    }
                    void runComponent(task, record)
                        .catch(error => {
                            const wrapped = AgentError.from(error, 'Graph component execution failed');
                            record.status = wrapped.code === 'GRAPH_EXECUTION_ABORTED' ? 'cancelled' : 'failed';
                            record.completedAt = this.now();
                            record.error = wrapped.message;
                            this.emitEvent({
                                runId,
                                type: 'component_failed',
                                timestamp: record.completedAt,
                                executionId: record.executionId,
                                componentId: record.componentId,
                                message: wrapped.message,
                            });
                            throw error;
                        })
                        .then(
                            () => {
                                activeCount -= 1;
                                if (task.concurrencyKey) {
                                    const nextCount = (activeCountByKey.get(task.concurrencyKey) ?? 1) - 1;
                                    if (nextCount <= 0) {
                                        activeCountByKey.delete(task.concurrencyKey);
                                    } else {
                                        activeCountByKey.set(task.concurrencyKey, nextCount);
                                    }
                                }
                                pump();
                                maybeComplete();
                            },
                            error => {
                                activeCount -= 1;
                                if (task.concurrencyKey) {
                                    const nextCount = (activeCountByKey.get(task.concurrencyKey) ?? 1) - 1;
                                    if (nextCount <= 0) {
                                        activeCountByKey.delete(task.concurrencyKey);
                                    } else {
                                        activeCountByKey.set(task.concurrencyKey, nextCount);
                                    }
                                }
                                const wrapped = AgentError.from(error, 'Graph execution failed');
                                if (wrapped.code === 'GRAPH_EXECUTION_ABORTED') {
                                    cancel(wrapped.message);
                                    return;
                                }
                                fail(error);
                            },
                        );
                }

                maybeComplete();
            };

            pump();
        });
    }

    private buildExecutionContext(
        runId: string,
        sourceGraph: DirectedGraph,
        graph: DirectedGraph,
        plan: GraphExecutionPlan,
        startNodeIds: string[],
        executionRecords: Map<string, GraphExecutionRecord>,
        execution: GraphExecutionRecord,
    ): GraphNodeExecutionContext<TSharedContext> {
        const executionStack: GraphExecutionRecord[] = [];
        let current: GraphExecutionRecord | undefined = execution;

        while (current) {
            executionStack.push({
                ...current,
                nodeIds: [...current.nodeIds],
                dependencyComponentIds: [...current.dependencyComponentIds],
                childExecutionIds: [...current.childExecutionIds],
            });
            current = current.parentExecutionId ? executionRecords.get(current.parentExecutionId) : undefined;
        }

        executionStack.reverse();
        const parentExecution =
            execution.parentExecutionId !== undefined ? executionRecords.get(execution.parentExecutionId) : undefined;

        return {
            runId,
            startNodeIds: [...startNodeIds],
            sourceGraph,
            graph,
            plan,
            execution: {
                ...execution,
                nodeIds: [...execution.nodeIds],
                dependencyComponentIds: [...execution.dependencyComponentIds],
                childExecutionIds: [...execution.childExecutionIds],
            },
            parentExecution:
                parentExecution !== undefined
                    ? {
                          ...parentExecution,
                          nodeIds: [...parentExecution.nodeIds],
                          dependencyComponentIds: [...parentExecution.dependencyComponentIds],
                          childExecutionIds: [...parentExecution.childExecutionIds],
                      }
                    : undefined,
            executionStack,
            shared: this.sharedContext,
            now: this.now,
        };
    }

    private createSchedulerTask(
        componentId: string,
        depth: number,
        parentExecutionId: string | undefined,
        state: PreparedGraphState<TResult>,
    ): SchedulerTask {
        return {
            componentId,
            parentExecutionId,
            depth,
            concurrencyKey: this.resolveComponentConcurrencyKey(componentId, state),
        };
    }

    private resolveComponentConcurrencyKey(
        componentId: string,
        state: PreparedGraphState<TResult>,
    ): string | undefined {
        if (!this.resolveConcurrencyKey) {
            return undefined;
        }

        const component = state.componentById.get(componentId)!;
        const nodes = component.nodeIds.map(nodeId => state.nodeById.get(nodeId)!);
        return this.resolveConcurrencyKey({
            component,
            nodes,
            graph: state.graph,
            plan: state.plan,
        });
    }

    private findRunnableTaskIndex(readyQueue: SchedulerTask[], activeCountByKey: Map<string, number>): number {
        for (let index = 0; index < readyQueue.length; index += 1) {
            const task = readyQueue[index];
            if (!task.concurrencyKey) {
                return index;
            }

            const limit = this.maxConcurrencyByKey[task.concurrencyKey];
            if (limit === undefined) {
                return index;
            }

            if ((activeCountByKey.get(task.concurrencyKey) ?? 0) < Math.max(1, limit)) {
                return index;
            }
        }

        return -1;
    }

    private resolveEffectiveNodeTimeoutMs(
        input: GraphNodeExecutionInput<TResult>,
        context: GraphNodeExecutionContext<TSharedContext>,
    ): number | undefined {
        const resolved = this.resolveNodeTimeoutMs?.(input as GraphNodeExecutionInput<unknown>, context);
        const timeoutMs = resolved ?? this.nodeTimeoutMs;

        if (timeoutMs === undefined || timeoutMs <= 0) {
            return undefined;
        }

        return timeoutMs;
    }

    private async executeNodeWithTimeout(
        input: GraphNodeExecutionInput<TResult>,
        context: GraphNodeExecutionContext<TSharedContext>,
        timeoutMs: number | undefined,
    ): Promise<TResult> {
        if (timeoutMs === undefined) {
            return await this.executeNode(input, context);
        }

        return await new Promise<TResult>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.emitEvent({
                    runId: input.runId,
                    type: 'node_timed_out',
                    timestamp: this.now(),
                    executionId: input.executionId,
                    componentId: input.component.id,
                    nodeId: input.node.id,
                    message: `Node ${input.node.id} timed out after ${timeoutMs}ms`,
                    data: {
                        timeoutMs,
                    },
                });
                reject(
                    new AgentError(`Node ${input.node.id} timed out after ${timeoutMs}ms`, {
                        code: 'GRAPH_NODE_TIMEOUT',
                    }),
                );
            }, timeoutMs);

            void this.executeNode(input, context).then(
                result => {
                    clearTimeout(timer);
                    resolve(result);
                },
                error => {
                    clearTimeout(timer);
                    reject(error);
                },
            );
        });
    }

    private throwIfAborted(): void {
        if (!this.signal?.aborted) {
            return;
        }

        throw new AgentError(
            this.signal.reason instanceof Error ? this.signal.reason.message : 'Graph execution cancelled',
            {
                code: 'GRAPH_EXECUTION_ABORTED',
            },
        );
    }

    private emitEvent(event: GraphExecutionEvent): void {
        if (!this.onEvent) {
            return;
        }

        try {
            void this.onEvent(event);
        } catch {
            // Observability hooks must not break production execution.
        }
    }

    private buildExecutionGraph(
        sourceGraph: DirectedGraph,
        scope: GraphExecutionScope,
    ): {
        graph: DirectedGraph;
        startNodeIds: string[];
    } {
        const requestedStartNodeIds = [...new Set(scope.startNodeIds ?? [])];
        if (requestedStartNodeIds.length === 0) {
            return {
                graph: sourceGraph,
                startNodeIds: sourceGraph.nodes
                    .filter(node => sourceGraph.edges.every(edge => edge.target !== node.id))
                    .map(node => node.id)
                    .sort(),
            };
        }

        const nodeById = new Map(sourceGraph.nodes.map(node => [node.id, node]));
        const outgoingByNode = new Map<string, string[]>();

        for (const node of sourceGraph.nodes) {
            outgoingByNode.set(node.id, []);
        }

        for (const edge of sourceGraph.edges) {
            if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
                continue;
            }
            outgoingByNode.get(edge.source)?.push(edge.target);
        }

        for (const nodeId of requestedStartNodeIds) {
            if (!nodeById.has(nodeId)) {
                throw new AgentError(`Graph start node not found: ${nodeId}`);
            }
        }

        const includedNodeIds = new Set<string>();
        const queue = [...requestedStartNodeIds];

        while (queue.length > 0) {
            const nodeId = queue.shift()!;
            if (includedNodeIds.has(nodeId)) {
                continue;
            }
            includedNodeIds.add(nodeId);
            for (const nextNodeId of outgoingByNode.get(nodeId) ?? []) {
                if (!includedNodeIds.has(nextNodeId)) {
                    queue.push(nextNodeId);
                }
            }
        }

        if (includedNodeIds.size === 0) {
            throw new AgentError('Graph execution scope did not include any nodes');
        }

        return {
            graph: {
                nodes: sourceGraph.nodes.filter(node => includedNodeIds.has(node.id)),
                edges: sourceGraph.edges.filter(
                    edge => includedNodeIds.has(edge.source) && includedNodeIds.has(edge.target),
                ),
            },
            startNodeIds: [...requestedStartNodeIds].sort(),
        };
    }

    private prepare(graph: DirectedGraph, plan: GraphExecutionPlan): PreparedGraphState<TResult> {
        const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
        const componentById = new Map(plan.components.map(component => [component.id, component]));
        const componentByNode = new Map<string, GraphComponent>();
        const outgoingComponents = new Map<string, Set<string>>();
        const incomingComponents = new Map<string, Set<string>>();
        const incomingNodesByNode = new Map<string, Set<string>>();
        const incomingRemaining = new Map<string, number>();

        this.validatePlanAgainstGraph(graph, plan, nodeById, componentById);

        for (const component of plan.components) {
            outgoingComponents.set(component.id, new Set());
            incomingComponents.set(component.id, new Set());
            incomingRemaining.set(component.id, 0);
            for (const nodeId of component.nodeIds) {
                componentByNode.set(nodeId, component);
            }
        }

        for (const node of graph.nodes) {
            incomingNodesByNode.set(node.id, new Set());
        }

        for (const edge of graph.edges) {
            const sourceComponent = componentByNode.get(edge.source)!;
            const targetComponent = componentByNode.get(edge.target)!;
            incomingNodesByNode.get(edge.target)?.add(edge.source);
            if (sourceComponent.id === targetComponent.id) {
                continue;
            }
            outgoingComponents.get(sourceComponent.id)!.add(targetComponent.id);
            incomingComponents.get(targetComponent.id)!.add(sourceComponent.id);
        }

        for (const [componentId, dependencies] of incomingComponents) {
            incomingRemaining.set(componentId, dependencies.size);
        }

        return {
            graph,
            plan,
            nodeById,
            componentById,
            componentByNode,
            outgoingComponents: new Map(
                [...outgoingComponents].map(([componentId, targets]) => [componentId, [...targets].sort()]),
            ),
            incomingComponents: new Map(
                [...incomingComponents].map(([componentId, sources]) => [componentId, [...sources].sort()]),
            ),
            incomingNodesByNode: new Map(
                [...incomingNodesByNode].map(([nodeId, sources]) => [nodeId, [...sources].sort()]),
            ),
            incomingRemaining,
            results: new Map(),
            executionOrder: [],
            executionRecords: new Map(),
            executionList: [],
            scheduledComponents: new Set(),
            completedComponents: new Set(),
        };
    }

    private validatePlanAgainstGraph(
        graph: DirectedGraph,
        plan: GraphExecutionPlan,
        nodeById: Map<string, GraphNode>,
        componentById: Map<string, GraphComponent>,
    ): void {
        const plannedNodeIds = new Set(plan.nodes.map(node => node.nodeId));
        const componentNodeIds = new Set(plan.components.flatMap(component => component.nodeIds));

        if (plannedNodeIds.size !== graph.nodes.length || componentNodeIds.size !== graph.nodes.length) {
            throw new AgentError('Graph execution plan does not cover the same node set as the graph');
        }

        for (const node of graph.nodes) {
            if (!plannedNodeIds.has(node.id) || !componentNodeIds.has(node.id)) {
                throw new AgentError(`Graph execution plan is missing node: ${node.id}`);
            }
        }

        for (const plannedNode of plan.nodes) {
            if (!nodeById.has(plannedNode.nodeId)) {
                throw new AgentError(`Graph execution plan references unknown node: ${plannedNode.nodeId}`);
            }
            if (!componentById.has(plannedNode.componentId)) {
                throw new AgentError(`Graph execution plan references unknown component: ${plannedNode.componentId}`);
            }
        }

        for (const batch of plan.batches) {
            for (const componentId of batch.componentIds) {
                if (!componentById.has(componentId)) {
                    throw new AgentError(`Graph execution plan batch references unknown component: ${componentId}`);
                }
            }
        }
    }

    private buildPredecessorResults(
        nodeId: string,
        incomingNodesByNode: Map<string, string[]>,
        results: Map<string, TResult>,
    ): Record<string, TResult> {
        const predecessorResults: Record<string, TResult> = {};

        for (const predecessorId of incomingNodesByNode.get(nodeId) ?? []) {
            if (results.has(predecessorId)) {
                predecessorResults[predecessorId] = results.get(predecessorId)!;
            }
        }

        return predecessorResults;
    }
}

/** Convenience helper for one-shot graph execution. */
export async function executeGraph<TResult, TSharedContext extends Record<string, unknown> = Record<string, never>>(
    graph: DirectedGraph,
    executeNode: GraphNodeExecutor<TResult, TSharedContext>,
    config?: GraphExecutionEngineConfig<TSharedContext>,
): Promise<GraphRunResult<TResult>> {
    return await new GraphExecutionEngine<TResult, TSharedContext>(executeNode, config).execute(graph);
}

/** Convenience helper for executing only the selected start nodes and their downstream graph. */
export async function executeGraphFrom<TResult, TSharedContext extends Record<string, unknown> = Record<string, never>>(
    graph: DirectedGraph,
    scope: GraphExecutionScope,
    executeNode: GraphNodeExecutor<TResult, TSharedContext>,
    config?: GraphExecutionEngineConfig<TSharedContext>,
): Promise<GraphRunResult<TResult>> {
    return await new GraphExecutionEngine<TResult, TSharedContext>(executeNode, config).executeFrom(graph, scope);
}
