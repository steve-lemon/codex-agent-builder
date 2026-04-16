// Vitest specs for flow document modeling.
import { describe, expect, it } from 'vitest';
import { AgentError } from '../errors/agent-error';
import { TextInputBlock, defineFlowBlock } from './blocks';
import {
    arePortTypesCompatible,
    connectFlowPorts,
    createFlowDocument,
    createFlowNode,
    registerFlowBlock,
} from './document';

describe('flow document', () => {
    it('creates nodes from block definitions with materialized ports', () => {
        const flow = createFlowDocument([TextInputBlock]);

        const created = createFlowNode(flow, 'text-input');

        expect(created.node).toMatchObject({
            id: 'text-input-1',
            blockId: 'text-input',
            label: 'Text Input',
            inputPorts: [],
            outputPorts: [
                {
                    id: 'text-input-1:text',
                    nodeId: 'text-input-1',
                    key: 'text',
                    label: 'Text',
                    direction: 'output',
                    dataType: 'text',
                },
            ],
        });
        expect(created.flow.nodes).toHaveLength(1);
    });

    it('registers additional blocks and creates nodes with custom labels', () => {
        const jsonSink = defineFlowBlock({
            id: 'json-sink',
            label: 'JSON Sink',
            inputs: [
                {
                    key: 'payload',
                    label: 'Payload',
                    direction: 'input',
                    dataType: 'json',
                },
            ],
            outputs: [],
        });
        const baseFlow = createFlowDocument();
        const flow = registerFlowBlock(baseFlow, jsonSink);

        const created = createFlowNode(flow, 'json-sink', {
            label: 'Result Sink',
        });

        expect(created.node.label).toBe('Result Sink');
        expect(created.node.inputPorts[0]?.dataType).toBe('json');
    });

    it('connects compatible ports between nodes', () => {
        const textOutput = TextInputBlock;
        const textConsumer = defineFlowBlock({
            id: 'text-consumer',
            label: 'Text Consumer',
            inputs: [
                {
                    key: 'input',
                    label: 'Input',
                    direction: 'input',
                    dataType: 'text',
                },
            ],
            outputs: [],
        });
        let flow = createFlowDocument([textOutput, textConsumer]);
        const source = createFlowNode(flow, 'text-input');
        flow = source.flow;
        const target = createFlowNode(flow, 'text-consumer');
        flow = target.flow;

        const connected = connectFlowPorts(flow, {
            sourceNodeId: source.node.id,
            sourcePort: 'text',
            targetNodeId: target.node.id,
            targetPort: 'input',
        });

        expect(connected.edge).toEqual({
            id: `${source.node.id}:text->${target.node.id}:input`,
            sourceNodeId: source.node.id,
            sourcePortId: `${source.node.id}:text`,
            targetNodeId: target.node.id,
            targetPortId: `${target.node.id}:input`,
            label: undefined,
        });
        expect(connected.flow.edges).toHaveLength(1);
    });

    it('allows any-typed ports to connect with typed ports', () => {
        expect(arePortTypesCompatible('any', 'json')).toBe(true);
        expect(arePortTypesCompatible('text', 'any')).toBe(true);
        expect(arePortTypesCompatible('image', 'image')).toBe(true);
        expect(arePortTypesCompatible('text', 'json')).toBe(false);
    });

    it('rejects incompatible port connections', () => {
        const jsonSource = defineFlowBlock({
            id: 'json-source',
            label: 'JSON Source',
            inputs: [],
            outputs: [
                {
                    key: 'payload',
                    label: 'Payload',
                    direction: 'output',
                    dataType: 'json',
                },
            ],
        });
        const textConsumer = defineFlowBlock({
            id: 'text-consumer',
            label: 'Text Consumer',
            inputs: [
                {
                    key: 'input',
                    label: 'Input',
                    direction: 'input',
                    dataType: 'text',
                },
            ],
            outputs: [],
        });
        let flow = createFlowDocument([jsonSource, textConsumer]);
        const source = createFlowNode(flow, 'json-source');
        flow = source.flow;
        const target = createFlowNode(flow, 'text-consumer');
        flow = target.flow;

        expect(() =>
            connectFlowPorts(flow, {
                sourceNodeId: source.node.id,
                sourcePort: 'payload',
                targetNodeId: target.node.id,
                targetPort: 'input',
            }),
        ).toThrow(/incompatible/);
    });

    it('rejects duplicate block port keys and duplicate edges', () => {
        expect(() =>
            defineFlowBlock({
                id: 'bad-block',
                label: 'Bad Block',
                inputs: [
                    {
                        key: 'same',
                        label: 'Same',
                        direction: 'input',
                        dataType: 'text',
                    },
                ],
                outputs: [
                    {
                        key: 'same',
                        label: 'Same',
                        direction: 'output',
                        dataType: 'text',
                    },
                ],
            }),
        ).toThrow(AgentError);

        const consumer = defineFlowBlock({
            id: 'text-consumer',
            label: 'Text Consumer',
            inputs: [
                {
                    key: 'input',
                    label: 'Input',
                    direction: 'input',
                    dataType: 'text',
                },
            ],
            outputs: [],
        });
        let flow = createFlowDocument([TextInputBlock, consumer]);
        const source = createFlowNode(flow, 'text-input');
        flow = source.flow;
        const target = createFlowNode(flow, 'text-consumer');
        flow = target.flow;
        const first = connectFlowPorts(flow, {
            sourceNodeId: source.node.id,
            sourcePort: 'text',
            targetNodeId: target.node.id,
            targetPort: 'input',
        });

        expect(() =>
            connectFlowPorts(first.flow, {
                sourceNodeId: source.node.id,
                sourcePort: 'text',
                targetNodeId: target.node.id,
                targetPort: 'input',
            }),
        ).toThrow(/already exists/);
    });
});
