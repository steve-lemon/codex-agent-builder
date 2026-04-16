// Vitest specs for flow-to-graph conversion and planning.
import { describe, expect, it } from 'vitest';
import { defineFlowBlock, TextInputBlock } from './blocks';
import { connectFlowPorts, createFlowDocument, createFlowNode } from './document';
import { convertFlowToGraph, DefaultFlowGraphAdapter, planFlowGraph } from './graph';
import type { FlowNode } from './types';

describe('flow graph conversion', () => {
    it('converts flow nodes and edges into the generic graph representation', () => {
        const textConsumer = defineFlowBlock({
            id: 'text-consumer',
            label: 'Text Consumer',
            inputs: [
                {
                    localId: 'input',
                    label: 'Input',
                    direction: 'input',
                    dataType: 'text',
                },
            ],
            outputs: [],
        });
        let flow = createFlowDocument([TextInputBlock, textConsumer]);
        const source = createFlowNode(flow, 'text-input');
        flow = source.flow;
        const target = createFlowNode(flow, 'text-consumer');
        flow = target.flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: source.node.id,
            sourcePort: 'text',
            targetNodeId: target.node.id,
            targetPort: 'input',
            label: 'user text',
        }).flow;

        const converted = convertFlowToGraph(flow);

        expect(converted.graph).toEqual({
            nodes: [
                {
                    id: source.node.id,
                    label: source.node.label,
                    data: {
                        blockId: 'text-input',
                        config: undefined,
                        inputPortIds: [],
                        outputPortIds: [`${source.node.id}:text`],
                    },
                },
                {
                    id: target.node.id,
                    label: target.node.label,
                    data: {
                        blockId: 'text-consumer',
                        config: undefined,
                        inputPortIds: [`${target.node.id}:input`],
                        outputPortIds: [],
                    },
                },
            ],
            edges: [
                {
                    source: source.node.id,
                    target: target.node.id,
                    label: 'user text',
                    data: {
                        flowEdgeId: `${source.node.id}:text->${target.node.id}:input`,
                        sourcePortId: `${source.node.id}:text`,
                        targetPortId: `${target.node.id}:input`,
                    },
                },
            ],
        });
    });

    it('plans converted flows with the existing graph execution planner', () => {
        const passthrough = defineFlowBlock({
            id: 'passthrough',
            label: 'Passthrough',
            inputs: [
                {
                    localId: 'input',
                    label: 'Input',
                    direction: 'input',
                    dataType: 'text',
                },
            ],
            outputs: [
                {
                    localId: 'output',
                    label: 'Output',
                    direction: 'output',
                    dataType: 'text',
                },
            ],
        });
        const textSink = defineFlowBlock({
            id: 'text-sink',
            label: 'Text Sink',
            inputs: [
                {
                    localId: 'inputA',
                    label: 'Input A',
                    direction: 'input',
                    dataType: 'text',
                },
                {
                    localId: 'inputB',
                    label: 'Input B',
                    direction: 'input',
                    dataType: 'text',
                },
            ],
            outputs: [],
        });

        let flow = createFlowDocument([TextInputBlock, passthrough, textSink]);
        const input = createFlowNode(flow, 'text-input', { nodeId: 'input' });
        flow = input.flow;
        const branchA = createFlowNode(flow, 'passthrough', { nodeId: 'branchA' });
        flow = branchA.flow;
        const branchB = createFlowNode(flow, 'passthrough', { nodeId: 'branchB' });
        flow = branchB.flow;
        const sink = createFlowNode(flow, 'text-sink', { nodeId: 'sink' });
        flow = sink.flow;

        flow = connectFlowPorts(flow, {
            sourceNodeId: 'input',
            sourcePort: 'text',
            targetNodeId: 'branchA',
            targetPort: 'input',
        }).flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'input',
            sourcePort: 'text',
            targetNodeId: 'branchB',
            targetPort: 'input',
        }).flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'branchA',
            sourcePort: 'output',
            targetNodeId: 'sink',
            targetPort: 'inputA',
            edgeId: 'branchA->sink',
        }).flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'branchB',
            sourcePort: 'output',
            targetNodeId: 'sink',
            targetPort: 'inputB',
            edgeId: 'branchB->sink',
        }).flow;

        const planned = planFlowGraph(flow);

        expect(planned.graph.nodes.map(node => node.id)).toEqual(['input', 'branchA', 'branchB', 'sink']);
        expect(planned.plan.batches.map(batch => [...batch.nodeIds].sort())).toEqual([
            ['input'],
            ['branchA', 'branchB'],
            ['sink'],
        ]);
        expect(planned.plan.nodes.map(node => [node.nodeId, node.priority])).toEqual([
            ['branchA', 2],
            ['branchB', 2],
            ['input', 1],
            ['sink', 3],
        ]);
    });

    it('allows subclasses to customize graph conversion metadata', () => {
        class TaggedFlowGraphAdapter extends DefaultFlowGraphAdapter {
            protected override toGraphNode(node: FlowNode) {
                const converted = super.toGraphNode(node);
                return {
                    ...converted,
                    data: {
                        ...converted.data,
                        source: 'custom-adapter',
                    },
                };
            }
        }

        const adapter = new TaggedFlowGraphAdapter();
        let flow = createFlowDocument([TextInputBlock]);
        flow = createFlowNode(flow, 'text-input', { nodeId: 'input' }).flow;

        const converted = adapter.convert(flow);

        expect(converted.graph.nodes[0]?.data).toMatchObject({
            source: 'custom-adapter',
        });
    });
});
