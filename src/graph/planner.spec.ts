// Vitest specs for graph execution planning.
import { describe, expect, it } from 'vitest';
import { AgentError } from '../errors/agent-error';
import { GraphExecutionPlanner, planGraphExecution } from './planner';
import type { DirectedGraph } from './types';

function makeGraph(nodeIds: string[], edges: Array<[string, string]>): DirectedGraph {
    return {
        nodes: nodeIds.map(id => ({ id })),
        edges: edges.map(([source, target]) => ({ source, target })),
    };
}

describe('GraphExecutionPlanner', () => {
    it('plans a simple linear graph with increasing priority', () => {
        const plan = planGraphExecution(
            makeGraph(
                ['A', 'B', 'C'],
                [
                    ['A', 'B'],
                    ['B', 'C'],
                ],
            ),
        );

        expect(plan.hasCycles).toBe(false);
        expect(plan.batches.map(batch => batch.nodeIds)).toEqual([['A'], ['B'], ['C']]);
        expect(plan.nodes.map(node => [node.nodeId, node.priority])).toEqual([
            ['A', 1],
            ['B', 2],
            ['C', 3],
        ]);
    });

    it('plans branches in parallel when they share the same predecessor', () => {
        const plan = planGraphExecution(
            makeGraph(
                ['A', 'B', 'C'],
                [
                    ['A', 'B'],
                    ['A', 'C'],
                ],
            ),
        );

        expect(plan.batches.map(batch => batch.nodeIds.sort())).toEqual([['A'], ['B', 'C']]);
    });

    it('puts converging nodes after all predecessors', () => {
        const plan = planGraphExecution(
            makeGraph(
                ['A', 'B', 'C'],
                [
                    ['A', 'C'],
                    ['B', 'C'],
                ],
            ),
        );

        expect(plan.batches.map(batch => batch.nodeIds.sort())).toEqual([['A', 'B'], ['C']]);
        expect(plan.nodes.find(node => node.nodeId === 'C')?.predecessorIds).toEqual(['A', 'B']);
    });

    it('collapses loops into a single execution batch and marks nodes as cyclic', () => {
        const plan = planGraphExecution(
            makeGraph(
                ['A', 'B', 'C'],
                [
                    ['A', 'B'],
                    ['B', 'A'],
                    ['B', 'C'],
                ],
            ),
        );

        expect(plan.hasCycles).toBe(true);
        expect(plan.components.find(component => component.inCycle)?.nodeIds).toEqual(['A', 'B']);
        expect(plan.batches.map(batch => batch.nodeIds.sort())).toEqual([['A', 'B'], ['C']]);
        expect(plan.nodes.find(node => node.nodeId === 'A')?.inCycle).toBe(true);
        expect(plan.nodes.find(node => node.nodeId === 'B')?.priority).toBe(1);
        expect(plan.nodes.find(node => node.nodeId === 'C')?.priority).toBe(2);
    });

    it('rejects self edges and unknown edge endpoints', () => {
        const planner = new GraphExecutionPlanner();

        expect(() => planner.plan(makeGraph(['A'], [['A', 'A']]))).toThrow(/Self edges are not supported/);
        expect(() =>
            planner.plan({
                nodes: [{ id: 'A' }],
                edges: [{ source: 'A', target: 'B' }],
            }),
        ).toThrow(/Edge target node not found: B/);
    });

    it('scales to large acyclic graphs efficiently enough for planning', () => {
        const nodeCount = 1000;
        const nodes = Array.from({ length: nodeCount }, (_, index) => `N${index}`);
        const edges: Array<[string, string]> = [];

        for (let index = 0; index < nodeCount - 1; index += 1) {
            edges.push([`N${index}`, `N${index + 1}`]);
            if (index + 2 < nodeCount) {
                edges.push([`N${index}`, `N${index + 2}`]);
            }
        }

        const plan = planGraphExecution(makeGraph(nodes, edges));

        expect(plan.nodes).toHaveLength(nodeCount);
        expect(plan.batches[0]?.nodeIds).toEqual(['N0']);
        expect(plan.hasCycles).toBe(false);
    });

    it('rejects duplicate node ids', () => {
        expect(() =>
            planGraphExecution({
                nodes: [{ id: 'A' }, { id: 'A' }],
                edges: [],
            }),
        ).toThrowError(AgentError);
    });
});
