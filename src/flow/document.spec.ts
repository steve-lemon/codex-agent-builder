// Vitest specs for flow document modeling.
import { describe, expect, it } from 'vitest';
import { AgentError } from '../errors/agent-error';
import { TextInputBlock, defineFlowBlock } from './blocks';
import {
    DefaultFlowDocumentController,
    FlowDocumentController,
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
    validateFlowNode,
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
            configs: [
                {
                    id: 'requiredMode',
                    label: 'Mode',
                    hint: 'select',
                    options: [
                        { value: 'append', label: 'Append' },
                        { value: 'replace', label: 'Replace' },
                    ],
                    required: true,
                },
                {
                    id: 'enabled',
                    label: 'Enabled',
                    hint: 'checkbox',
                    defaultValue: 'true',
                },
                {
                    id: 'limit',
                    label: 'Limit',
                    hint: 'number',
                    defaultValue: '10',
                },
            ],
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
            config: {
                requiredMode: 'append',
                limit: '25',
            },
        });

        expect(created.node.label).toBe('Result Sink');
        expect(created.node.inputPorts[0]?.dataType).toBe('json');
        expect(created.node.config).toEqual({
            requiredMode: 'append',
            enabled: 'true',
            limit: '25',
        });
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

    it('preserves null packet values across connected ports without coercing them', () => {
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
        flow = createFlowNode(flow, 'json-source', { nodeId: 'jsonSource' }).flow;
        flow = createFlowNode(flow, 'text-consumer', { nodeId: 'textTarget' }).flow;
        flow = setFlowPortPacket(flow, {
            nodeId: 'jsonSource',
            port: 'out',
            packet: createFlowPacket(null, 456),
        }).flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'jsonSource',
            sourcePort: 'out',
            targetNodeId: 'textTarget',
            targetPort: 'in',
        }).flow;

        expect(getFlowPortById(flow, 'jsonSource:out')?.packet).toEqual({
            value: null,
            ts: 456,
        });
        expect(getFlowPortById(flow, 'textTarget:in')?.packet).toEqual({
            value: null,
            ts: 456,
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
        expect(arePortTypesCompatible('number', 'text')).toBe(true);
        expect(arePortTypesCompatible('text', 'number')).toBe(true);
        expect(arePortTypesCompatible('number', 'json')).toBe(true);
        expect(arePortTypesCompatible('json', 'number')).toBe(true);
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
        expect(coercePacketForPort('number', createFlowPacket('42.5', 16))).toEqual({
            value: 42.5,
            ts: 16,
        });
        expect(coercePacketForPort('text', createFlowPacket(7, 17))).toEqual({
            value: '7',
            ts: 17,
        });
        expect(coercePacketForPort('json', createFlowPacket(9, 18))).toEqual({
            value: 9,
            ts: 18,
        });
        expect(coercePacketForPort('number', createFlowPacket(null, 19))).toEqual({
            value: null,
            ts: 19,
        });
        expect(coercePacketForPort('image', createFlowPacket('https://example.com/a.png', 13))).toEqual({
            value: 'https://example.com/a.png',
            ts: 13,
        });
        expect(coercePacketForPort('text', createFlowPacket(null, 14))).toEqual({
            value: null,
            ts: 14,
        });
        expect(coercePacketForPort('json', createFlowPacket(null, 15))).toEqual({
            value: null,
            ts: 15,
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
        expect(() => coercePacketForPort('number', createFlowPacket('not-a-number', 1))).toThrow(/parsed as a number/);
        expect(() => coercePacketForPort('number', createFlowPacket(Number.NaN, 1))).toThrow(/finite value/);
        expect(() => coercePacketForPort('number', createFlowPacket({ bad: true }, 1))).toThrow(/finite number or numeric string/);

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

    it('allows subclasses to override document policies without changing the public workflow', () => {
        class PrefixedFlowController extends DefaultFlowDocumentController {
            protected override createNodeId(blockId: string): string {
                return `custom-${blockId}`;
            }

            protected override createEdgeId(sourcePort: { id: string }, targetPort: { id: string }): string {
                return `edge:${sourcePort.id}->${targetPort.id}`;
            }
        }

        const controller: FlowDocumentController = new PrefixedFlowController();
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

        let flow = controller.createDocument([TextInputBlock, consumer]);
        const source = controller.createNode(flow, 'text-input');
        flow = source.flow;
        const target = controller.createNode(flow, 'text-consumer', { nodeId: 'target' });
        flow = target.flow;

        const connected = controller.connectPorts(flow, {
            sourceNodeId: source.node.id,
            sourcePort: 'text',
            targetNodeId: 'target',
            targetPort: 'in',
        });

        expect(source.node.id).toBe('custom-text-input');
        expect(connected.edge.id).toBe('edge:custom-text-input:text->target:in');
    });

    it('validates node config against block config requirements', () => {
        const configurable = defineFlowBlock({
            id: 'configurable',
            label: 'Configurable',
            configs: [
                {
                    id: 'mode',
                    label: 'Mode',
                    hint: 'select',
                    options: [
                        { value: 'fast', label: 'Fast' },
                        { value: 'safe', label: 'Safe' },
                    ],
                    required: true,
                },
                {
                    id: 'enabled',
                    label: 'Enabled',
                    hint: 'checkbox',
                },
                {
                    id: 'retries',
                    label: 'Retries',
                    hint: 'number',
                },
            ],
            inputs: [],
            outputs: [],
        });

        let flow = createFlowDocument([configurable]);
        flow = createFlowNode(flow, 'configurable', {
            nodeId: 'node-1',
            config: {
                enabled: 'false',
                retries: '3',
            },
        }).flow;

        expect(validateFlowNode(flow, 'node-1')).toEqual({
            isValid: false,
            issues: [
                {
                    code: 'missing_required_config',
                    configId: 'mode',
                    message: 'Required config is missing on node node-1: mode',
                },
            ],
        });

        flow = createFlowNode(flow, 'configurable', {
            nodeId: 'node-2',
            config: {
                mode: 'invalid',
                stray: 'value',
            },
        }).flow;

        expect(validateFlowNode(flow, 'node-2')).toEqual({
            isValid: false,
            issues: [
                {
                    code: 'unknown_config',
                    configId: 'stray',
                    message: 'Unknown config is stored on node node-2: stray',
                },
                {
                    code: 'invalid_select_option',
                    configId: 'mode',
                    message: 'Config value is not one of the allowed options: mode',
                },
            ],
        });

        flow = createFlowNode(flow, 'configurable', {
            nodeId: 'node-3',
            config: {
                mode: 'safe',
                enabled: 'true',
                retries: '5',
            },
        }).flow;

        expect(validateFlowNode(flow, 'node-3')).toEqual({
            isValid: true,
            issues: [],
        });
    });
});
