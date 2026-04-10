// Graph rendering helpers for Mermaid, execution-plan visualization, and Reagraph JSON output.
import type { DirectedGraph, GraphExecutionPlan, GraphExecutionRecord } from './types';

/** Reagraph-compatible node shape. */
export interface ReagraphNode {
    id: string;
    label: string;
    icon?: string;
    state?: string;
}

/** Reagraph-compatible edge shape. */
export interface ReagraphEdge {
    source: string;
    target: string;
    id?: string;
    label?: string;
}

/** Reagraph-compatible graph payload. */
export interface ReagraphGraph {
    nodes: ReagraphNode[];
    edges: ReagraphEdge[];
}

/** Options for building Reagraph JSON payloads. */
export interface ReagraphRenderOptions {
    /** Optional plan used to annotate labels with execution priority. */
    plan?: GraphExecutionPlan;

    /** Whether to append execution priority to the node label. */
    includePriorityInLabel?: boolean;

    /** Optional icon lookup by node id. */
    iconByNodeId?: Record<string, string>;

    /** Optional explicit state lookup by node id. */
    stateByNodeId?: Record<string, string>;

    /** Optional execution records used to infer node state when no explicit state exists. */
    executions?: GraphExecutionRecord[];
}

/**
 * Renders a directed graph as Mermaid flowchart syntax.
 *
 * @example
 * ```ts
 * const mermaid = renderGraphAsMermaid({
 *     nodes: [{ id: 'A' }, { id: 'B' }],
 *     edges: [{ source: 'A', target: 'B' }],
 * });
 * ```
 */
export function renderGraphAsMermaid(graph: DirectedGraph): string {
    const lines: string[] = ['flowchart TD'];

    for (const node of [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id))) {
        const label = escapeMermaidLabel(node.label ?? node.id);
        lines.push(`    ${sanitizeId(node.id)}["${label}"]`);
    }

    for (const edge of graph.edges) {
        const source = sanitizeId(edge.source);
        const target = sanitizeId(edge.target);
        const label = edge.label ? `|${escapeMermaidLabel(edge.label)}|` : '';
        lines.push(`    ${source} -->${label} ${target}`);
    }

    return lines.join('\n');
}

/**
 * Renders a graph annotated with execution batches and cycle membership.
 *
 * @example
 * ```ts
 * const planMermaid = renderExecutionPlanAsMermaid(graph, plan);
 * ```
 */
export function renderExecutionPlanAsMermaid(graph: DirectedGraph, plan: GraphExecutionPlan): string {
    const lines: string[] = ['flowchart TD'];
    const nodePlan = new Map(plan.nodes.map(node => [node.nodeId, node]));

    for (const node of [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id))) {
        const planned = nodePlan.get(node.id)!;
        const cycleSuffix = planned.inCycle ? ' | cycle' : '';
        const label = escapeMermaidLabel(`${node.label ?? node.id}\nP${planned.priority}${cycleSuffix}`);
        lines.push(`    ${sanitizeId(node.id)}["${label}"]`);
    }

    for (const edge of graph.edges) {
        lines.push(`    ${sanitizeId(edge.source)} --> ${sanitizeId(edge.target)}`);
    }

    for (const batch of plan.batches) {
        for (const nodeId of batch.nodeIds.sort()) {
            lines.push(
                `    style ${sanitizeId(nodeId)} fill:${colorForBatch(batch.batch)},stroke:#333,stroke-width:1px`,
            );
        }
    }

    return lines.join('\n');
}

/**
 * Renders a directed graph as a Reagraph-compatible JSON payload.
 *
 * @example
 * ```ts
 * const json = renderGraphAsReagraph(graph, {
 *     plan,
 *     includePriorityInLabel: true,
 *     stateByNodeId: { A: 'running' },
 * });
 * ```
 */
export function renderGraphAsReagraph(graph: DirectedGraph, options: ReagraphRenderOptions = {}): ReagraphGraph {
    const nodePlan = new Map(options.plan?.nodes.map(node => [node.nodeId, node]) ?? []);
    const inferredStateByNodeId = inferNodeStates(options.executions ?? []);
    const nodes = [...graph.nodes]
        .sort((left, right) => {
            const leftPriority = nodePlan.get(left.id)?.priority ?? Number.MAX_SAFE_INTEGER;
            const rightPriority = nodePlan.get(right.id)?.priority ?? Number.MAX_SAFE_INTEGER;
            if (leftPriority !== rightPriority) {
                return leftPriority - rightPriority;
            }
            return left.id.localeCompare(right.id);
        })
        .map(node => {
            const planned = nodePlan.get(node.id);
            const priorityLabel =
                options.includePriorityInLabel && planned !== undefined ? ` (P${planned.priority})` : '';

            return {
                id: node.id,
                label: `${node.label ?? node.id}${priorityLabel}`,
                icon: options.iconByNodeId?.[node.id],
                state: options.stateByNodeId?.[node.id] ?? inferredStateByNodeId[node.id],
            };
        });

    const edges = graph.edges.map((edge, index) => ({
        source: edge.source,
        target: edge.target,
        id: `${edge.source}->${edge.target}:${index + 1}`,
        label: edge.label,
    }));

    return {
        nodes,
        edges,
    };
}

function sanitizeId(value: string): string {
    return value.replace(/[^a-zA-Z0-9_]/g, '_');
}

function escapeMermaidLabel(value: string): string {
    return value.replace(/"/g, '\\"');
}

function colorForBatch(batch: number): string {
    const palette = ['#D8F3DC', '#FCE38A', '#FFD6A5', '#BDE0FE', '#E4C1F9', '#CDEAC0'];
    return palette[(batch - 1) % palette.length]!;
}

function inferNodeStates(executions: GraphExecutionRecord[]): Record<string, string> {
    const stateByNodeId: Record<string, string> = {};

    for (const execution of executions) {
        for (const nodeId of execution.nodeIds) {
            stateByNodeId[nodeId] = execution.status;
        }
    }

    return stateByNodeId;
}
