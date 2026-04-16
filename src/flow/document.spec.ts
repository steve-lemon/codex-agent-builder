// Vitest specs for flow document modeling.
import { describe, expect, it } from 'vitest';
import { AgentError } from '../errors/agent-error';
import { TextInputBlock, defineFlowBlock } from './blocks';
import {
    arePortTypesCompatible,
    coercePacketForPort,
    connectFlowPorts,
    createFlowDocument,
    createFlowNode,
    createFlowPacket,
    getFlowPortById,
    registerFlowBlock,
    resolveFlowPortDataType,
    setFlowPortPacket,
} from './document';

describe('flow document', () => {
    it('creates nodes from block definitions with materialized ports and global ids', () => {
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
                    localId: 'text',
                    label: 'Text',
                    direction: 'output',
                    dataType: 'text',
                    packet: undefined,
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
                    localId: 'in',
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

    it('connects compatible ports between nodes and enforces single incoming edge per input port', () => {
        const textConsumer = defineFlowBlock({
            id: 'text-consumer',
            label: 'Text Consumer',
            inputs: [
                {
                    localId: 'in',
                    label: 'Input',
                    direction: 'input',
                    dataType: 'text',
                },
            ],
            outputs: [],
        });
        let flow = createFlowDocument([TextInputBlock, textConsumer]);
        const source = createFlowNode(flow, 'text-input', { nodeId: 'source' });
        flow = source.flow;
        const target = createFlowNode(flow, 'text-consumer', { nodeId: 'target' });
        flow = target.flow;

        const connected = connectFlowPorts(flow, {
            sourceNodeId: 'source',
            sourcePort: 'text',
            targetNodeId: 'target',
            targetPort: 'in',
        });

        expect(connected.edge).toEqual({
            id: 'source:text->target:in',
            sourceNodeId: 'source',
            sourcePortId: 'source:text',
            targetNodeId: 'target',
            targetPortId: 'target:in',
            label: undefined,
        });

        const secondSource = createFlowNode(connected.flow, 'text-input', { nodeId: 'source2' });
        expect(() =>
            connectFlowPorts(secondSource.flow, {
                sourceNodeId: 'source2',
                sourcePort: 'text',
                targetNodeId: 'target',
                targetPort: 'in',
            }),
        ).toThrow(/already connected/);
    });

    it('supports packet creation, storage, and coercion for connected ports', () => {
        const jsonSource = defineFlowBlock({
            id: 'json-source',
            label: 'JSON Source',
            inputs: [],
            outputs: [
                {
                    localId: 'out',
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
                    localId: 'in',
                    label: 'Input',
                    direction: 'input',
                    dataType: 'text',
                },
            ],
            outputs: [],
        });

        let flow = createFlowDocument([jsonSource, textConsumer]);
        const source = createFlowNode(flow, 'json-source', { nodeId: 'jsonSource' });
        flow = source.flow;
        const target = createFlowNode(flow, 'text-consumer', { nodeId: 'textTarget' });
        flow = target.flow;
        flow = setFlowPortPacket(flow, {
            nodeId: 'jsonSource',
            port: 'out',
            packet: createFlowPacket({ hello: 'world' }, 123),
        }).flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'jsonSource',
            sourcePort: 'out',
            targetNodeId: 'textTarget',
            targetPort: 'in',
        }).flow;

        expect(getFlowPortById(flow, 'jsonSource:out')?.packet).toEqual({
            value: { hello: 'world' },
            ts: 123,
        });
        expect(getFlowPortById(flow, 'textTarget:in')?.packet).toEqual({
            value: '{"hello":"world"}',
            ts: 123,
        });
    });

    it('allows any-typed inputs to adopt the connected source type', () => {
        const anyConsumer = defineFlowBlock({
            id: 'any-consumer',
            label: 'Any Consumer',
            inputs: [
                {
                    localId: 'in',
                    label: 'Input',
                    direction: 'input',
                    dataType: 'any',
                },
            ],
            outputs: [],
        });
        let flow = createFlowDocument([TextInputBlock, anyConsumer]);
        const source = createFlowNode(flow, 'text-input', { nodeId: 'source' });
        flow = source.flow;
        const target = createFlowNode(flow, 'any-consumer', { nodeId: 'target' });
        flow = target.flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'source',
            sourcePort: 'text',
            targetNodeId: 'target',
            targetPort: 'in',
        }).flow;

        expect(resolveFlowPortDataType(flow, 'target', 'in')).toBe('text');
    });

    it('supports built-in compatibility rules and packet coercion helpers', () => {
        expect(arePortTypesCompatible('any', 'json')).toBe(true);
        expect(arePortTypesCompatible('text', 'any')).toBe(true);
        expect(arePortTypesCompatible('json', 'text')).toBe(true);
        expect(arePortTypesCompatible('text', 'json')).toBe(true);
        expect(arePortTypesCompatible('image', 'text')).toBe(true);
        expect(arePortTypesCompatible('text', 'image')).toBe(true);
        expect(arePortTypesCompatible('image', 'image')).toBe(true);

        expect(coercePacketForPort('json', createFlowPacket('{"a":1}', 11))).toEqual({
            value: { a: 1 },
            ts: 11,
        });
        expect(coercePacketForPort('text', createFlowPacket({ a: 1 }, 12))).toEqual({
            value: '{"a":1}',
            ts: 12,
        });
        expect(coercePacketForPort('image', createFlowPacket('https://example.com/a.png', 13))).toEqual({
            value: 'https://example.com/a.png',
            ts: 13,
        });
    });

    it('rejects invalid conversions, duplicate local ids, and duplicate edges', () => {
        expect(() =>
            defineFlowBlock({
                id: 'bad-block',
                label: 'Bad Block',
                inputs: [
                    {
                        localId: 'same',
                        label: 'Same',
                        direction: 'input',
                        dataType: 'text',
                    },
                ],
                outputs: [
                    {
                        localId: 'same',
                        label: 'Same',
                        direction: 'output',
                        dataType: 'text',
                    },
                ],
            }),
        ).toThrow(AgentError);

        expect(() => coercePacketForPort('json', createFlowPacket('not-json', 1))).toThrow(/parsed as JSON/);
        expect(() => coercePacketForPort('image', createFlowPacket({ bad: true }, 1))).toThrow(/image packet/);

        const consumer = defineFlowBlock({
            id: 'text-consumer',
            label: 'Text Consumer',
            inputs: [
                {
                    localId: 'in',
                    label: 'Input',
                    direction: 'input',
                    dataType: 'text',
                },
            ],
            outputs: [],
        });
        let flow = createFlowDocument([TextInputBlock, consumer]);
        const source = createFlowNode(flow, 'text-input', { nodeId: 'source' });
        flow = source.flow;
        const target = createFlowNode(flow, 'text-consumer', { nodeId: 'target' });
        flow = target.flow;
        const first = connectFlowPorts(flow, {
            sourceNodeId: 'source',
            sourcePort: 'text',
            targetNodeId: 'target',
            targetPort: 'in',
        });

        expect(() =>
            connectFlowPorts(first.flow, {
                sourceNodeId: 'source',
                sourcePort: 'text',
                targetNodeId: 'target',
                targetPort: 'in',
                edgeId: 'duplicate',
            }),
        ).toThrow(/already connected/);
    });
});
