// Vitest specs for graph rendering helpers.
import { describe, expect, it } from 'vitest';
import { planGraphExecution } from './planner';
import { renderExecutionPlanAsMermaid, renderGraphAsMermaid } from './renderer';
import type { DirectedGraph } from './types';

function makeGraph(nodeIds: string[], edges: Array<[string, string]>): DirectedGraph {
    return {
        nodes: nodeIds.map(id => ({ id })),
        edges: edges.map(([source, target]) => ({ source, target })),
    };
}

describe('graph renderer', () => {
    it('renders a basic directed graph as Mermaid flowchart syntax', () => {
        const graph = makeGraph(
            ['A', 'B', 'C'],
            [
                ['A', 'B'],
                ['A', 'C'],
            ],
        );

        const mermaid = renderGraphAsMermaid(graph);

        expect(mermaid).toContain('flowchart TD');
        expect(mermaid).toContain('A["A"]');
        expect(mermaid).toContain('A --> B');
        expect(mermaid).toContain('A --> C');
    });

    it('renders edge labels and escapes node labels for Mermaid output', () => {
        const mermaid = renderGraphAsMermaid({
            nodes: [
                { id: 'node/a', label: 'Node "A"' },
                { id: 'node-b', label: 'Node B' },
            ],
            edges: [{ source: 'node/a', target: 'node-b', label: 'depends on' }],
        });

        expect(mermaid).toContain('node_a["Node \\"A\\""]');
        expect(mermaid).toContain('node_a -->|depends on| node_b');
    });

    it('renders execution priority and styles for a planned graph', () => {
        const graph = makeGraph(
            ['A', 'B', 'C'],
            [
                ['A', 'B'],
                ['A', 'C'],
            ],
        );
        const plan = planGraphExecution(graph);

        const mermaid = renderExecutionPlanAsMermaid(graph, plan);

        expect(mermaid).toContain('A["A\nP1"]');
        expect(mermaid).toContain('B["B\nP2"]');
        expect(mermaid).toContain('style B');
        expect(mermaid).toContain('style C');
    });

    it('marks cyclic nodes in the execution-plan Mermaid output', () => {
        const graph = makeGraph(
            ['A', 'B', 'C'],
            [
                ['A', 'B'],
                ['B', 'A'],
                ['B', 'C'],
            ],
        );
        const plan = planGraphExecution(graph);

        const mermaid = renderExecutionPlanAsMermaid(graph, plan);

        expect(mermaid).toContain('A["A\nP1 | cycle"]');
        expect(mermaid).toContain('B["B\nP1 | cycle"]');
        expect(mermaid).toContain('C["C\nP2"]');
    });
});
