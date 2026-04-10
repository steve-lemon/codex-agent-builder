// Vitest specs for graph rendering helpers.
import { describe, expect, it } from 'vitest';
import { planGraphExecution } from './planner';
import { renderExecutionPlanAsMermaid, renderGraphAsMermaid, renderGraphAsReagraph } from './renderer';
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

    it('renders a reagraph-compatible graph payload', () => {
        const graph = {
            nodes: [{ id: 'A', label: 'Alpha' }, { id: 'B' }],
            edges: [{ source: 'A', target: 'B', label: 'next' }],
        } satisfies DirectedGraph;

        const rendered = renderGraphAsReagraph(graph);

        expect(rendered).toEqual({
            nodes: [
                { id: 'A', label: 'Alpha', icon: undefined, state: undefined },
                { id: 'B', label: 'B', icon: undefined, state: undefined },
            ],
            edges: [{ source: 'A', target: 'B', id: 'A->B:1', label: 'next' }],
        });
    });

    it('can include execution priority in reagraph node labels', () => {
        const graph = makeGraph(['A', 'B'], [['A', 'B']]);
        const plan = planGraphExecution(graph);

        const rendered = renderGraphAsReagraph(graph, {
            plan,
            includePriorityInLabel: true,
        });

        expect(rendered.nodes).toEqual([
            { id: 'A', label: 'A (P1)', icon: undefined, state: undefined },
            { id: 'B', label: 'B (P2)', icon: undefined, state: undefined },
        ]);
    });

    it('orders reagraph nodes by execution priority when a plan is provided', () => {
        const graph = makeGraph(
            ['C', 'A', 'B'],
            [
                ['A', 'B'],
                ['B', 'C'],
            ],
        );
        const plan = planGraphExecution(graph);

        const rendered = renderGraphAsReagraph(graph, { plan });

        expect(rendered.nodes.map(node => node.id)).toEqual(['A', 'B', 'C']);
    });

    it('prefers explicit node state and can infer state from execution records', () => {
        const graph = makeGraph(
            ['A', 'B', 'C'],
            [
                ['A', 'B'],
                ['B', 'C'],
            ],
        );

        const rendered = renderGraphAsReagraph(graph, {
            stateByNodeId: {
                B: 'running',
            },
            executions: [
                {
                    executionId: 'exec-1',
                    componentId: 'component-1',
                    nodeIds: ['A'],
                    depth: 0,
                    status: 'completed',
                    dependencyComponentIds: [],
                    childExecutionIds: [],
                },
                {
                    executionId: 'exec-2',
                    parentExecutionId: 'exec-1',
                    componentId: 'component-2',
                    nodeIds: ['B', 'C'],
                    depth: 1,
                    status: 'running',
                    dependencyComponentIds: ['component-1'],
                    childExecutionIds: [],
                },
            ],
        });

        expect(rendered.nodes).toEqual([
            { id: 'A', label: 'A', icon: undefined, state: 'completed' },
            { id: 'B', label: 'B', icon: undefined, state: 'running' },
            { id: 'C', label: 'C', icon: undefined, state: 'running' },
        ]);
    });

    it('supports icon overrides in reagraph nodes', () => {
        const rendered = renderGraphAsReagraph(makeGraph(['A'], []), {
            iconByNodeId: {
                A: 'database',
            },
        });

        expect(rendered.nodes).toEqual([{ id: 'A', label: 'A', icon: 'database', state: undefined }]);
    });
});
