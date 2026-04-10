// Vitest specs for graph execution scheduling and delegation.
import { describe, expect, it } from 'vitest';
import { GraphExecutionEngine, executeGraph, executeGraphFrom } from './executor';
import type { DirectedGraph, GraphExecutionPlan, GraphNodeExecutionInput } from './types';

function makeGraph(nodeIds: string[], edges: Array<[string, string]>): DirectedGraph {
    return {
        nodes: nodeIds.map(id => ({ id })),
        edges: edges.map(([source, target]) => ({ source, target })),
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('GraphExecutionEngine', () => {
    it('executes a linear graph in dependency order', async () => {
        const graph = makeGraph(
            ['A', 'B', 'C'],
            [
                ['A', 'B'],
                ['B', 'C'],
            ],
        );
        const seenInputs: string[] = [];

        const result = await executeGraph(graph, async input => {
            seenInputs.push(input.node.id);
            return `${input.node.id}:done`;
        });

        expect(result.status).toBe('completed');
        expect(result.executionOrder).toEqual(['A', 'B', 'C']);
        expect(seenInputs).toEqual(['A', 'B', 'C']);
        expect(result.results).toEqual({
            A: 'A:done',
            B: 'B:done',
            C: 'C:done',
        });
    });

    it('delegates branch executions and waits for converging predecessors', async () => {
        const graph = makeGraph(
            ['A', 'B', 'C', 'D'],
            [
                ['A', 'B'],
                ['B', 'C'],
                ['A', 'D'],
                ['D', 'C'],
            ],
        );
        let activeBranchCount = 0;
        let maxBranchCount = 0;
        let bCompleted = false;
        let dCompleted = false;
        let cInput: GraphNodeExecutionInput<string> | undefined;

        const engine = new GraphExecutionEngine<string>(async input => {
            if (input.node.id === 'B' || input.node.id === 'D') {
                activeBranchCount += 1;
                maxBranchCount = Math.max(maxBranchCount, activeBranchCount);
                await sleep(20);
                activeBranchCount -= 1;
            }

            if (input.node.id === 'B') {
                bCompleted = true;
            }
            if (input.node.id === 'D') {
                dCompleted = true;
            }
            if (input.node.id === 'C') {
                cInput = input;
                expect(bCompleted).toBe(true);
                expect(dCompleted).toBe(true);
            }

            return `${input.node.id}:ok`;
        });

        const result = await engine.execute(graph);
        const aExecution = result.executions.find(record => record.nodeIds.includes('A'));

        expect(result.status).toBe('completed');
        expect(maxBranchCount).toBe(2);
        expect(cInput?.predecessorResults).toEqual({
            B: 'B:ok',
            D: 'D:ok',
        });
        expect(aExecution?.childExecutionIds).toHaveLength(2);
        expect(
            aExecution?.childExecutionIds
                .map(
                    childExecutionId =>
                        result.executions.find(record => record.executionId === childExecutionId)?.nodeIds[0],
                )
                .sort(),
        ).toEqual(['B', 'D']);
    });

    it('passes execution context as the second argument to node executors', async () => {
        const graph = makeGraph(['A', 'B'], [['A', 'B']]);
        const seenStacks: string[][] = [];

        const result = await executeGraph<string, { traceLabel: string }>(
            graph,
            async (input, context) => {
                seenStacks.push(context.executionStack.map(record => record.nodeIds.join('+')));
                expect(context.runId).toContain('graph-run');
                expect(context.graph.nodes.map(node => node.id)).toEqual(['A', 'B']);
                expect(context.sourceGraph.nodes.map(node => node.id)).toEqual(['A', 'B']);
                expect(context.shared.traceLabel).toBe('graph-trace');
                expect(context.execution.executionId).toBe(input.executionId);
                if (input.node.id === 'A') {
                    expect(context.parentExecution).toBeUndefined();
                }
                if (input.node.id === 'B') {
                    expect(context.parentExecution?.nodeIds).toEqual(['A']);
                }
                return `${context.shared.traceLabel}:${input.node.id}`;
            },
            {
                sharedContext: {
                    traceLabel: 'graph-trace',
                },
            },
        );

        expect(result.status).toBe('completed');
        expect(seenStacks).toEqual([['A'], ['A', 'B']]);
        expect(result.results).toEqual({
            A: 'graph-trace:A',
            B: 'graph-trace:B',
        });
    });

    it('executes loop components once and then continues to downstream nodes', async () => {
        const graph = makeGraph(
            ['A', 'B', 'C'],
            [
                ['A', 'B'],
                ['B', 'A'],
                ['B', 'C'],
            ],
        );
        const counts = new Map<string, number>();

        const result = await executeGraph(graph, async input => {
            counts.set(input.node.id, (counts.get(input.node.id) ?? 0) + 1);
            return input.node.id;
        });

        const loopExecution = result.executions.find(record => record.nodeIds.length === 2);

        expect(result.status).toBe('completed');
        expect(counts.get('A')).toBe(1);
        expect(counts.get('B')).toBe(1);
        expect(counts.get('C')).toBe(1);
        expect(loopExecution?.nodeIds).toEqual(['A', 'B']);
        expect(result.executionOrder[result.executionOrder.length - 1]).toBe('C');
    });

    it('respects the configured concurrency limit across independent branches', async () => {
        const graph = makeGraph(
            ['A', 'B', 'C', 'D', 'E'],
            [
                ['A', 'B'],
                ['A', 'C'],
                ['A', 'D'],
                ['A', 'E'],
            ],
        );
        let running = 0;
        let maxRunning = 0;

        const result = await executeGraph(
            graph,
            async input => {
                if (input.node.id !== 'A') {
                    running += 1;
                    maxRunning = Math.max(maxRunning, running);
                    await sleep(15);
                    running -= 1;
                }
                return input.node.id;
            },
            {
                maxConcurrency: 2,
            },
        );

        expect(result.status).toBe('completed');
        expect(maxRunning).toBe(2);
    });

    it('returns a failed run result when node execution errors', async () => {
        const graph = makeGraph(['A', 'B'], [['A', 'B']]);

        const result = await executeGraph(graph, async input => {
            if (input.node.id === 'B') {
                throw new Error('boom');
            }
            return input.node.id;
        });

        const failedExecution = result.executions.find(record => record.status === 'failed');

        expect(result.status).toBe('failed');
        expect(result.error).toBe('boom');
        expect(result.results).toEqual({ A: 'A' });
        expect(failedExecution?.nodeIds).toEqual(['B']);
    });

    it('rejects a precomputed plan that does not match the graph nodes', async () => {
        const graph = makeGraph(['A', 'B'], [['A', 'B']]);
        const invalidPlan: GraphExecutionPlan = {
            nodes: [
                {
                    nodeId: 'A',
                    componentId: 'component_1',
                    batch: 1,
                    priority: 1,
                    inCycle: false,
                    predecessorIds: [],
                    successorIds: ['B'],
                },
            ],
            batches: [
                {
                    batch: 1,
                    nodeIds: ['A'],
                    componentIds: ['component_1'],
                },
            ],
            components: [
                {
                    id: 'component_1',
                    nodeIds: ['A'],
                    inCycle: false,
                },
            ],
            hasCycles: false,
        };

        await expect(
            new GraphExecutionEngine(async input => input.node.id).execute(graph, invalidPlan),
        ).rejects.toThrow(/does not cover the same node set/);
    });

    it('returns an immutable failure snapshot even if other branches finish later', async () => {
        const graph = makeGraph(['A', 'B'], []);

        const result = await executeGraph(
            graph,
            async input => {
                if (input.node.id === 'A') {
                    throw new Error('A failed');
                }
                await sleep(30);
                return 'B finished';
            },
            {
                maxConcurrency: 2,
            },
        );

        expect(result.status).toBe('failed');
        expect(result.results).toEqual({});
        await sleep(60);
        expect(result.results).toEqual({});
        expect(result.executions.map(record => record.status)).not.toContain('completed');
    });

    it('can start execution from a middle node and only runs downstream nodes', async () => {
        const graph = makeGraph(
            ['A', 'B', 'C'],
            [
                ['A', 'B'],
                ['B', 'C'],
            ],
        );
        const seen: string[] = [];

        const result = await executeGraphFrom<string>(
            graph,
            {
                startNodeIds: ['B'],
            },
            async input => {
                seen.push(input.node.id);
                return input.node.id;
            },
        );

        expect(result.status).toBe('completed');
        expect(result.startNodeIds).toEqual(['B']);
        expect(result.graph.nodes.map(node => node.id)).toEqual(['B', 'C']);
        expect(result.executionOrder).toEqual(['B', 'C']);
        expect(seen).toEqual(['B', 'C']);
        expect(result.results).toEqual({
            B: 'B',
            C: 'C',
        });
    });

    it('treats predecessors outside the selected scope as non-blocking for downstream joins', async () => {
        const graph = makeGraph(
            ['A', 'B', 'C', 'D'],
            [
                ['A', 'B'],
                ['B', 'D'],
                ['C', 'D'],
            ],
        );
        let dInput: GraphNodeExecutionInput<string> | undefined;

        const result = await executeGraphFrom<string>(
            graph,
            {
                startNodeIds: ['B'],
            },
            async input => {
                if (input.node.id === 'D') {
                    dInput = input;
                }
                return `${input.node.id}:done`;
            },
        );

        expect(result.status).toBe('completed');
        expect(result.graph.nodes.map(node => node.id)).toEqual(['B', 'D']);
        expect(result.executionOrder).toEqual(['B', 'D']);
        expect(dInput?.predecessorResults).toEqual({
            B: 'B:done',
        });
    });

    it('rejects unknown start nodes when creating a scoped execution', async () => {
        const graph = makeGraph(['A'], []);

        await expect(
            executeGraphFrom(
                graph,
                {
                    startNodeIds: ['missing'],
                },
                async input => input.node.id,
            ),
        ).rejects.toThrow(/Graph start node not found: missing/);
    });
});
