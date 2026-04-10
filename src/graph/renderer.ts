// Graph rendering helpers for Mermaid and execution-plan visualization.
import type { DirectedGraph, GraphExecutionPlan } from './types';

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
